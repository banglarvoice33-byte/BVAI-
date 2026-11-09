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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('audio')
    parser.add_argument('output')
    parser.add_argument('--script-file')
    args = parser.parse_args()
    key = os.environ.get('GROQ_API_KEY', '')
    if not key:
        raise ValueError('GROQ_API_KEY missing')
    audio = Path(args.audio)
    if not audio.is_file() or not 1024 <= audio.stat().st_size <= 24 * 1024 * 1024:
        raise ValueError('Audio missing, too small or exceeds configured 24 MiB upload bound')
    duration = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(audio)], text=True, timeout=15).strip())
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Invalid audio duration')
    script = Path(args.script_file).read_text(encoding='utf8') if args.script_file else ''
    boundary = 'BVAI' + uuid.uuid4().hex
    fields = {'model':'whisper-large-v3-turbo', 'response_format':'verbose_json', 'language':'bn', 'timestamp_granularities[]':'word', 'temperature':'0'}
    if script:
        fields['prompt'] = script[:1200]
    body = bytearray()
    for name, value in fields.items():
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n'.encode())
    body.extend(audio.read_bytes())
    body.extend(f'\r\n--{boundary}--\r\n'.encode())
    req = urllib.request.Request('https://api.groq.com/openai/v1/audio/transcriptions', data=bytes(body), headers={'Authorization':f'Bearer {key}', 'Content-Type':f'multipart/form-data; boundary={boundary}'})
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(f'Groq HTTP {error.code}; check credentials, model access, quota and file format') from None
    vtt = build_vtt(payload.get('words'), duration)
    # Keep ASR text attached to ASR times. A prompt improves spelling but is not forced alignment.
    # Detect poor agreement instead of assigning unrelated timestamps to script words.
    if script:
        import difflib
        import re
        normalize = lambda text: re.sub(r'[^\w\s]', '', text).split()
        similarity = difflib.SequenceMatcher(None, normalize(script), normalize(' '.join(str(w['word']) for w in payload['words']))).ratio()
        threshold = float(os.environ.get('CAPTION_MIN_SCRIPT_MATCH', '0.65'))
        if similarity < threshold:
            raise ValueError(f'Script/transcript agreement {similarity:.2f} below {threshold:.2f}; review pronunciation/transcription')
    output = Path(args.output)
    tmp = output.with_suffix(output.suffix + '.part')
    tmp.write_text(vtt, encoding='utf8')
    tmp.replace(output)
    print(f'Whisper VTT: {len(payload["words"])} actual-audio words')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Caption failed: {error}', file=sys.stderr)
        sys.exit(1)
