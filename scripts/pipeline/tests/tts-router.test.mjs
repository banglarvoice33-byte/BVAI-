import { test } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

test('ElevenLabs router puts output_format in the query string', async () => {
  process.env.TTS_ELEVENLABS_1 = 'test-key';
  process.env.ELEVENLABS_VOICE_ID = 'voice/test';
  process.env.ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
  process.env.ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      async arrayBuffer() { return Buffer.from('audio').buffer; },
    };
  };
  const { synthesizeVoiceRouted } = await import(`../tts-router.js?test=${Date.now()}`);
  const result = await synthesizeVoiceRouted('বাংলা পরীক্ষামূলক বর্ণনা');
  assert.equal(result.provider, 'elevenLabs');
  assert.match(request.url, /output_format=mp3_44100_128/);
  assert.match(request.url, /voice%2Ftest/);
  assert.equal(JSON.parse(request.options.body).model_id, 'eleven_multilingual_v2');
  assert.equal(request.options.headers['xi-api-key'], 'test-key');
});

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});
