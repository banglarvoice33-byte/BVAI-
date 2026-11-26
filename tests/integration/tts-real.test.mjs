// Real ElevenLabs TTS integration test. Requires TTS_ELEVENLABS_1 + ELEVENLABS_VOICE_ID.
// Run: TTS_ELEVENLABS_1=... ELEVENLABS_VOICE_ID=... node --test tests/integration/tts-real.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { synthesizeTts } from '../../ops/worker/tts-client.mjs';

const KEY = process.env.TTS_ELEVENLABS_1;
const VOICE = process.env.ELEVENLABS_VOICE_ID;
const skip = !KEY || !VOICE ? 'ElevenLabs credentials missing' : false;

test('elevenlabs produces real bengali mp3 bytes', { skip, timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-real-'));
  const out = path.join(dir, 'bn.mp3');
  try {
    await synthesizeTts({
      apiKey: KEY,
      voiceId: VOICE,
      text: 'আমি বাংলায় কথা বলি।',
      outPath: out,
    });
    const buf = fs.readFileSync(out);
    assert.ok(buf.length > 1000, `mp3 too small: ${buf.length} bytes`);
    const hasId3  = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33;
    const hasSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
    assert.ok(hasId3 || hasSync, `not mp3: ${buf.subarray(0, 4).toString('hex')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
