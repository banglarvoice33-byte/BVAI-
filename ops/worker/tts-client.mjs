import fs from 'node:fs';

async function elevenLabs(text, outPath) {
  const key = process.env.TTS_ELEVENLABS_1;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) throw new Error('elevenlabs_credentials_missing');
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
  });
  if (!r.ok) throw new Error(`elevenlabs_${r.status}`);
  fs.writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
  return { provider: 'elevenlabs', path: outPath };
}

async function cartesia(text, outPath) {
  const key = process.env.TTS_CARTESIA_KEY;
  const voice = process.env.CARTESIA_VOICE_ID;
  if (!key || !voice) throw new Error('cartesia_credentials_missing');
  const r = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: { 'X-API-Key': key, 'Cartesia-Version': '2024-06-10', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: 'sonic-2', transcript: text, voice: { mode: 'id', id: voice }, output_format: { container: 'mp3', sample_rate: 44100 } }),
  });
  if (!r.ok) throw new Error(`cartesia_${r.status}`);
  fs.writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
  return { provider: 'cartesia', path: outPath };
}

async function sarvam(text, outPath) {
  const key = process.env.TTS_SARVAM_KEY;
  if (!key) throw new Error('sarvam_credentials_missing');
  const r = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: [text], target_language_code: 'bn-IN', speaker: 'meera', model: 'bulbul:v2' }),
  });
  if (!r.ok) throw new Error(`sarvam_${r.status}`);
  const j = await r.json();
  const b64 = j.audios?.[0];
  if (!b64) throw new Error('sarvam_empty');
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  return { provider: 'sarvam', path: outPath };
}

export async function synthesizeTts(text, outPath) {
  const chain = [elevenLabs, cartesia, sarvam];
  const errors = [];
  for (const fn of chain) {
    try { return await fn(text, outPath); }
    catch (e) { errors.push(`${fn.name}:${e.message}`); }
  }
  throw new Error(`all_tts_failed:${errors.join('|')}`);
}
