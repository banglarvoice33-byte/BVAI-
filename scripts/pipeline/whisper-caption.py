"""Caption the actual voice audio; no proportional word-index remapping."""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import urllib.error
import re
import uuid


def fmt(value):
    ms = max(0, round(value * 1000))
    return f"{ms//3600000:02d}:{(ms//60000)%60:02d}:{(ms//1000)%60:02d}.{ms%1000:03d}"


def build_vtt(words, duration):
    if not isinstance(words, list) or not words:
        raise ValueError('API returned no word timestamps')
    cues = ['WEBVTT', '']
    previous_end = 0.0
    for item in words:
        start, end = float(item['start']), float(item['end'])
        word = str(item['word']).replace('\n', ' ').replace('-->', '→').strip()
        if not word or not all(math.isfinite(v) for v in (start, end)):
            raise ValueError('Invalid word metadata')
        if start < 0 or end <= start or start < previous_end - 0.02 or end > duration + 0.25:
            raise ValueError('Invalid/overlapping/out-of-range word timing')
        # Small boundary jitter is clamped; no fabricated word timings are inserted.
        start = max(previous_end, start)
        end = min(duration, end)
        if end - start < 0.001:
            raise ValueError('Word duration too short')
        cues.extend([f'{fmt(start)} --> {fmt(end)}', word, ''])
        previous_end = end
    if previous_end < duration * 0.65:
        raise ValueError('Transcription ends too early; editorial review required')
    return '\n'.join(cues) + '\n'


class ApiHttpError(Exception):
    def __init__(self, label, code, detail):
        super().__init__(f'{label} HTTP {code}: {detail}')
        self.code = code
        self.detail = detail


def redact(text, key, limit=200):
    text = str(text or '')
    if key:
        text = text.replace(key, '[key]')
    text = re.sub(r'(?:gsk_|sk-)[A-Za-z0-9_-]{8,}', '[key]', text)
    text = re.sub(r'Bearer\s+\S+', 'Bearer [key]', text, flags=re.I)
    return re.sub(r'\s+', ' ', text).strip()[:limit]


# Groq rejects a Whisper prompt above 896 "characters" with HTTP 400 and measures it in UTF-8 bytes (a Bengali letter is
# 3 bytes), so 1200 characters of Bengali script was ~3x over the limit. OpenAI keeps only the last 224 tokens anyway.
PROMPT_MAX_BYTES = 800


def fit_prompt(text, max_bytes=PROMPT_MAX_BYTES):
    data = (text or '').strip().encode('utf8')
    if len(data) <= max_bytes:
        return data.decode('utf8')
    cut = data[:max_bytes].decode('utf8', 'ignore')  # never splits a multi-byte character
    head = cut.rsplit(None, 1)[0] if ' ' in cut else cut  # end on a whole word
    return head.strip()


def short_detail(text, limit=70):
    """Reduce an API error body to its message so several provider failures fit the 300-char job error."""
    text = str(text or '')
    try:
        body = text[text.index('{'):]
        message = json.loads(body).get('error', {}).get('message')
        if message:
            text = str(message)
    except Exception:
        pass
    return re.sub(r'\s+', ' ', text).strip()[:limit]


def transcribe(label, base, key, model, audio_bytes, prompt):
    boundary = 'BVAI' + uuid.uuid4().hex
    fields = {'model': model, 'response_format': 'verbose_json', 'language': 'bn', 'timestamp_granularities[]': 'word', 'temperature': '0'}
    if prompt:
        fields['prompt'] = prompt
    body = bytearray()
    for name, value in fields.items():
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n'.encode())
    body.extend(audio_bytes)
    body.extend(f'\r\n--{boundary}--\r\n'.encode())
    # Groq sits behind Cloudflare, which answers the default "Python-urllib/3.x" agent with 403 (error 1010) before the
    # request ever reaches the API. A descriptive agent is required; the key is only ever sent in Authorization.
    headers = {
        'Authorization': f'Bearer {key}',
        'Content-Type': f'multipart/form-data; boundary={boundary}',
        'Accept': 'application/json',
        'User-Agent': 'BVAI-Renderer/1.0 (+https://bvai-chi.vercel.app)',
    }
    req = urllib.request.Request(base + '/audio/transcriptions', data=bytes(body), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            detail = error.read(400).decode('utf8', 'replace')
        except Exception:
            detail = ''
        raise ApiHttpError(label, error.code, f'{model}: {redact(detail, key) or "no body"}') from None


def loopback_or(value, default):
    # Test hook only: a loopback base lets the offline tests prove headers/fallback. Any other value is ignored so a
    # bearer key can never be redirected to a third-party host through the environment.
    return value if value.startswith(('http://127.0.0.1:', 'http://localhost:')) else default


def providers_from_env(env):
    """Ordered (label, base, key, models, family). Duplicate keys are tried once; family groups keys of one API."""
    groq_base = loopback_or(env.get('GROQ_API_BASE', ''), 'https://api.groq.com/openai/v1')
    openai_base = loopback_or(env.get('OPENAI_API_BASE', ''), 'https://api.openai.com/v1')
    out, seen = [], set()
    # whisper-large-v3-turbo can be unavailable to an org/key (403/404) while whisper-large-v3 is allowed: try both.
    for label, var in (('Groq', 'GROQ_API_KEY'), ('Groq-vault', 'GROQ_API_KEY_VAULT')):
        key = (env.get(var) or '').strip()
        if key and key not in seen:
            seen.add(key)
            out.append((label, groq_base, key, ('whisper-large-v3-turbo', 'whisper-large-v3'), 'groq'))
    key = (env.get('CAPTION_OPENAI_API_KEY') or '').strip()
    if key and key not in seen:
        out.append(('OpenAI', openai_base, key, ('whisper-1',), 'openai'))
    return out


def run_provider(provider, audio_bytes, prompt, script, duration):
    label, base, key, models, _family = provider
    payload, last_error = None, None
    prompt = fit_prompt(prompt)
    for model in models:
        try:
            try:
                payload = transcribe(label, base, key, model, audio_bytes, prompt)
            except ApiHttpError as error:
                # The prompt only improves spelling; if a provider still rejects it, caption without it
                # (the script-agreement check below keeps the result honest).
                if error.code == 400 and prompt and 'prompt' in str(error).lower():
                    prompt = ''
                    payload = transcribe(label, base, key, model, audio_bytes, prompt)
                else:
                    raise
            break
        except ApiHttpError as error:
            last_error = error
            if error.code not in (403, 404):
                break
    if payload is None:
        raise last_error
    vtt = build_vtt(payload.get('words'), duration)
    # Keep ASR text attached to ASR times. A prompt improves spelling but is not forced alignment.
    # Detect poor agreement instead of assigning unrelated timestamps to script words.
    if script:
        import difflib
        normalize = lambda text: re.sub(r'[^\w\s]', '', text).split()
        similarity = difflib.SequenceMatcher(None, normalize(script), normalize(' '.join(str(w['word']) for w in payload['words']))).ratio()
        threshold = float(os.environ.get('CAPTION_MIN_SCRIPT_MATCH', '0.65'))
        if similarity < threshold:
            raise ValueError(f'Script/transcript agreement {similarity:.2f} below {threshold:.2f}; review pronunciation/transcription')
    return vtt, payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('audio')
    parser.add_argument('output')
    parser.add_argument('--script-file')
    args = parser.parse_args()
    providers = providers_from_env(os.environ)
    if not providers:
        raise ValueError('no caption API key (GROQ_API_KEY / GROQ_API_KEY_VAULT / CAPTION_OPENAI_API_KEY)')
    audio = Path(args.audio)
    if not audio.is_file() or not 1024 <= audio.stat().st_size <= 24 * 1024 * 1024:
        raise ValueError('Audio missing, too small or exceeds configured 24 MiB upload bound')
    duration = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(audio)], text=True, timeout=15).strip())
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Invalid audio duration')
    script = Path(args.script_file).read_text(encoding='utf8') if args.script_file else ''
    audio_bytes = audio.read_bytes()
    prompt = script[:1200] if script else ''
    failures = []
    skip_families = set()
    for provider in providers:
        label, _base, key, _models, family = provider
        if family in skip_families:
            continue
        try:
            vtt, payload = run_provider(provider, audio_bytes, prompt, script, duration)
        except Exception as error:  # any provider problem (HTTP, network, bad timings) falls through to the next one
            code = getattr(error, 'code', None)
            if code not in (401, 403, 429):
                skip_families.add(family)  # another key on the same API would fail identically (bad request, outage, timings)
            if isinstance(error, ApiHttpError):
                summary = f'{label} HTTP {error.code}: {short_detail(error.detail, 62)}'
            else:
                summary = f'{label}: {short_detail(error, 70)}'
            failures.append(redact(summary, key, 95))
            continue
        output = Path(args.output)
        tmp = output.with_suffix(output.suffix + '.part')
        tmp.write_text(vtt, encoding='utf8')
        tmp.replace(output)
        print(f'Whisper VTT ({label}): {len(payload["words"])} actual-audio words')
        return
    raise ValueError(' | '.join(failures))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Caption failed: {error}', file=sys.stderr)
        sys.exit(1)
