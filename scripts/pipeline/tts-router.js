import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';


function getKeys(prefix, count) {
  const keys = [];
  for (let i = 1; i <= count; i++) {
    const v = process.env[`${prefix}_${i}`];
    if (v) keys.push({ index: i, key: v });
  }
  return keys;
}


async function trySarvamSingle(text, keyObj) {
  const res = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': keyObj.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language_code: 'bn-IN', speaker: process.env.SARVAM_SPEAKER || 'priya', pace: 1.0, speech_sample_rate: 22050, model: 'bulbul:v3', output_audio_codec: 'mp3' }),
    signal: AbortSignal.timeout(90000)
  });
  if (!res.ok) { const eb = await res.text().catch(()=> ''); throw new Error(`Sarvam ${res.status} ${eb.slice(0,300)}`); }
  const data = await res.json();
  const b64 = data?.audios?.[0];
  if (!b64) throw new Error('Sarvam no audio');
  return Buffer.from(b64, 'base64');
}


export function splitText(text, limit = 450) {
  const chunks = []; let current = '';
  for (const word of String(text).trim().split(/\s+/)) {
    if (word.length > limit) throw new Error('Unbroken token exceeds TTS chunk limit');
    if (current && (current.length + 1 + word.length > limit)) { chunks.push(current); current = ''; }
    current += (current ? ' ' : '') + word;
  }
  if (current) chunks.push(current);
  return chunks;
}
async function trySarvam(text, keyObj) {
  const chunks = splitText(text);
  if (chunks.length === 1) return trySarvamSingle(chunks[0], keyObj);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarvam-'));
  try {
    const files = [];
    for (let i = 0; i < chunks.length; i++) {
      const f = path.join(tmpDir, `c${i}.mp3`);
      fs.writeFileSync(f, await trySarvamSingle(chunks[i], keyObj)); files.push(f);
    }
    const list = path.join(tmpDir, 'list.txt');
    fs.writeFileSync(list, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const out = path.join(tmpDir, 'joined.mp3');
    execFileSync('ffmpeg', ['-y','-v','error','-f','concat','-safe','0','-i',list,'-c:a','libmp3lame','-q:a','3',out], { timeout: 120000 });
    return fs.readFileSync(out);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
}

async function trySonexLabs(text, keyObj) {
  const res = await fetch('https://api.sonexlabs.com/v1/text-to-speech', {
    signal: AbortSignal.timeout(90000),
    method: 'POST',
    headers: { Authorization: `Bearer ${keyObj.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language: 'bn', voice: 'default' })
  });
  if (!res.ok) throw new Error(`SonexLabs ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('SonexLabs empty');
  return buf;
}

async function tryCartesia(text, keyObj) {
  const voiceId = process.env.CARTESIA_VOICE_ID;
  if (!voiceId) throw new Error('CARTESIA_VOICE_ID missing');
  const res = await fetch('https://api.cartesia.ai/tts/bytes', {
    signal: AbortSignal.timeout(90000),
    method: 'POST',
    headers: { 'X-API-Key': keyObj.key, 'Cartesia-Version': '2024-06-10', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: 'sonic-3', transcript: text, voice: { mode: 'id', id: voiceId }, output_format: { container: 'mp3', encoding: 'mp3', sample_rate: 44100 }, language: 'bn' })
  });
  if (!res.ok) throw new Error(`Cartesia ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('Cartesia empty');
  return buf;
}

async function tryElevenLabs(text, keyObj) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Error('ELEVENLABS_VOICE_ID missing');
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';
  const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
  endpoint.searchParams.set('output_format', outputFormat);
  const res = await fetch(endpoint, {
    signal: AbortSignal.timeout(90000),
    method: 'POST',
    headers: { 'xi-api-key': keyObj.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('ElevenLabs empty');
  return buf;
}

export async function synthesizeVoiceRouted(text, opts = {}) {
  const attempts = [
    ...getKeys('TTS_ELEVENLABS', 5).map(k => ({ provider: 'elevenLabs', ...k, fn: tryElevenLabs })),
    ...getKeys('TTS_SARVAM', 3).map(k => ({ provider: 'sarvam', ...k, fn: trySarvam })),
    ...getKeys('TTS_SONEXLABS', 3).map(k => ({ provider: 'sonexLabs', ...k, fn: trySonexLabs })),
    ...getKeys('TTS_CARTESIA', 2).map(k => ({ provider: 'cartesia', ...k, fn: tryCartesia })),
  ];
  let lastErr = null;
  for (const a of attempts) {
    try {
      const buf = await a.fn(text, a);
      if (opts.outFile) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-normalize-'));
        try {
          const raw = path.join(dir, 'raw'); fs.writeFileSync(raw, buf);
          execFileSync('ffmpeg', ['-y','-v','error','-i',raw,'-vn','-c:a','libmp3lame','-ar','44100','-b:a','128k',opts.outFile], { timeout: 120000 });
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
      }
      return { audio: opts.outFile ? fs.readFileSync(opts.outFile) : buf, provider: a.provider, keyIndex: a.index, chars: text.length };
    } catch (e) {
      console.warn(`[tts-router] ${a.provider}#${a.index} failed: ${e.message}`);
      lastErr = e;
    }
  }
  throw lastErr || new Error('No TTS provider available');
}
