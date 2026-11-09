import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const DAILY_CAP = 10;

function getKeys(prefix, count) {
  const keys = [];
  for (let i = 1; i <= count; i++) {
    const v = process.env[`${prefix}_${i}`];
    if (v) keys.push({ index: i, key: v });
  }
  return keys;
}

async function supabaseCountToday() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${url}/rest/v1/videos?select=id&created_at=gte.${today}T00:00:00&limit=100`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!res.ok) return 0;
    return (await res.json()).length;
  } catch { return 0; }
}

async function recordUsage(provider, keyIndex, chars) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    const month = new Date().toISOString().slice(0, 7);
    await fetch(`${url}/rest/v1/tts_usage`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ provider, key_index: keyIndex, month, chars_used: chars, videos: 1, updated_at: new Date().toISOString() })
    });
  } catch {}
}

async function trySarvamSingle(text, keyObj) {
  const res = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': keyObj.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: [text], target_language_code: 'bn-IN', speaker: 'priya', pitch: 0, pace: 1.0, loudness: 1.0, speech_sample_rate: 22050, enable_preprocessing: true, model: 'bulbul:v3' })
  });
  if (!res.ok) { const eb = await res.text().catch(()=> ''); throw new Error(`Sarvam ${res.status} ${eb.slice(0,300)}`); }
  const data = await res.json();
  const b64 = data?.audios?.[0];
  if (!b64) throw new Error('Sarvam no audio');
  return Buffer.from(b64, 'base64');
}


async function trySarvam(text, keyObj) {
  if (text.length <= 480) return trySarvamSingle(text, keyObj);
  // Split by sentences into <=450 char chunks
  const parts = text.split(/(?<=[।!?.\n])\s*/);
  const chunks = [];
  let cur = '';
  for (const part of parts) {
    if ((cur + part).length > 450 && cur) { chunks.push(cur); cur = part; }
    else cur += part;
  }
  if (cur) chunks.push(cur);
  if (chunks.length === 1) return trySarvamSingle(chunks[0], keyObj);
  console.log(`[tts-router] sarvam chunking ${chunks.length} parts`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarvam-'));
  const files = [];
  for (let i = 0; i < chunks.length; i++) {
    const buf = await trySarvamSingle(chunks[i], keyObj);
    const f = path.join(tmpDir, `c${i}.wav`);
    fs.writeFileSync(f, buf);
    files.push(f);
  }
  const listFile = path.join(tmpDir, 'list.txt');
  fs.writeFileSync(listFile, files.map(f => `file '${f}'`).join('\n'));
  const outFile = path.join(tmpDir, 'joined.mp3');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-q:a', '3', outFile]);
  const joined = fs.readFileSync(outFile);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  return joined;
}

async function trySonexLabs(text, keyObj) {
  const res = await fetch('https://api.sonexlabs.com/v1/text-to-speech', {
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
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': keyObj.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('ElevenLabs empty');
  return buf;
}

export async function synthesizeVoiceRouted(text, opts = {}) {
  const count = await supabaseCountToday();
  if (count >= DAILY_CAP) {
    const err = new Error('DAILY_CAP_REACHED');
    err.code = 'DAILY_CAP_REACHED';
    throw err;
  }
  const attempts = [
    ...getKeys('TTS_SARVAM', 3).map(k => ({ provider: 'sarvam', ...k, fn: trySarvam })),
    ...getKeys('TTS_SONEXLABS', 3).map(k => ({ provider: 'sonexLabs', ...k, fn: trySonexLabs })),
    ...getKeys('TTS_CARTESIA', 2).map(k => ({ provider: 'cartesia', ...k, fn: tryCartesia })),
    ...getKeys('TTS_ELEVENLABS', 5).map(k => ({ provider: 'elevenLabs', ...k, fn: tryElevenLabs })),
  ];
  let lastErr = null;
  for (const a of attempts) {
    try {
      const buf = await a.fn(text, a);
      await recordUsage(a.provider, a.index, text.length);
      if (opts.outFile) fs.writeFileSync(opts.outFile, buf);
      return { audio: buf, provider: a.provider, keyIndex: a.index, chars: text.length };
    } catch (e) {
      console.warn(`[tts-router] ${a.provider}#${a.index} failed: ${e.message}`);
      lastErr = e;
    }
  }
  throw lastErr || new Error('No TTS provider available');
}
