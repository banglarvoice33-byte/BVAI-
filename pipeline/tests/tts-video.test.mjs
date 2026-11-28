import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTtsRequest, resampleArgs, synthesizeScene } from '../elevenlabs-tts.mjs';
import { buildVideoRequest, pollVideo, resolvePollingUrl, submitVideo } from '../openrouter-video.mjs';

const base = { text: 'সকাল নয়টা', voiceId: 'VOICE123' };

test('TTS: Bengali uses eleven_v4, sends language_code and only stability/similarity', () => {
  const { url, body } = buildTtsRequest(base);
  assert.equal(url, 'https://api.elevenlabs.io/v1/text-to-speech/VOICE123?output_format=mp3_44100_128');
  assert.equal(body.model_id, 'eleven_v4');
  assert.equal(body.language_code, 'bn');
  assert.deepEqual(Object.keys(body.voice_settings).sort(), ['similarity_boost', 'stability']);
});

test('TTS: refuses multilingual_v2 for Bengali and refuses text that still has digits', () => {
  assert.throws(() => buildTtsRequest({ ...base, modelId: 'eleven_multilingual_v2' }), /not listed for Bengali/);
  assert.throws(() => buildTtsRequest({ ...base, text: 'আজ ৭৩ জন' }), /digits/);
});

test('TTS: dictionaries (max 3) and continuity text are passed through', () => {
  const dictionaries = [{ id: 'd1', versionId: 'v1' }, { id: 'd2' }];
  const { body } = buildTtsRequest({ ...base, dictionaries, previousText: 'আগের বাক্য', nextText: 'পরের বাক্য' });
  assert.deepEqual(body.pronunciation_dictionary_locators, [
    { pronunciation_dictionary_id: 'd1', version_id: 'v1' },
    { pronunciation_dictionary_id: 'd2' },
  ]);
  assert.equal(body.previous_text, 'আগের বাক্য');
  assert.throws(() => buildTtsRequest({ ...base, dictionaries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }), /at most 3/);
});

test('TTS: synthesizeScene returns bytes and surfaces API errors', async () => {
  const ok = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  const bytes = await synthesizeScene(buildTtsRequest(base), { apiKey: 'k', fetchImpl: ok });
  assert.equal(bytes.length, 3);
  const bad = async () => new Response('quota', { status: 429 });
  await assert.rejects(synthesizeScene(buildTtsRequest(base), { apiKey: 'k', fetchImpl: bad }), /ElevenLabs 429/);
  assert.deepEqual(resampleArgs('a.mp3', 'b.wav').slice(2), ['a.mp3', '-ar', '48000', '-ac', '2', 'b.wav']);
});

test('Video: request has no negative_prompt and validates enums and durations', () => {
  const req = buildVideoRequest({ model: 'google/veo-3.1', prompt: 'p', duration: 8, supportedDurations: [4, 6, 8] });
  assert.deepEqual(req, { model: 'google/veo-3.1', prompt: 'p', aspect_ratio: '9:16', duration: 8, resolution: '720p', generate_audio: false });
  assert.throws(() => buildVideoRequest({ model: 'm', prompt: 'p', duration: 7, supportedDurations: [4, 6, 8] }), /supported durations/);
  assert.throws(() => buildVideoRequest({ model: 'm', prompt: 'p', duration: 8, aspectRatio: '7:5' }), /aspect_ratio/);
  assert.throws(() => buildVideoRequest({ model: 'm', prompt: 'p', duration: 8, callbackUrl: 'http://x' }), /HTTPS/);
});

test('Video: relative polling_url is resolved against openrouter.ai', () => {
  assert.equal(resolvePollingUrl('/api/v1/videos/job-abc123'), 'https://openrouter.ai/api/v1/videos/job-abc123');
  assert.equal(resolvePollingUrl('https://openrouter.ai/api/v1/videos/x'), 'https://openrouter.ai/api/v1/videos/x');
});

test('Video: submit then poll until completed', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.method ?? 'GET']);
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'job-1', polling_url: '/api/v1/videos/job-1', status: 'pending' }), { status: 202 });
    }
    const n = calls.filter(([, m]) => m === 'GET').length;
    const body = n < 3 ? { status: 'in_progress' } : { status: 'completed', urls: ['https://signed/1.mp4'], usage: { cost: 0.5 } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const job = await submitVideo({ model: 'm' }, { apiKey: 'k', fetchImpl });
  assert.equal(job.pollingUrl, 'https://openrouter.ai/api/v1/videos/job-1');
  const out = await pollVideo(job.pollingUrl, { apiKey: 'k', fetchImpl, sleep: async () => {} });
  assert.deepEqual(out, { signedUrls: ['https://signed/1.mp4'], unsignedUrls: [], costUsd: 0.5 });
});

test('Video: failed jobs and timeouts throw', async () => {
  const failed = async () => new Response(JSON.stringify({ status: 'failed', error: 'moderation' }), { status: 200 });
  await assert.rejects(pollVideo('https://openrouter.ai/x', { apiKey: 'k', fetchImpl: failed, sleep: async () => {} }), /failed: moderation/);
  let t = 0;
  const pending = async () => new Response(JSON.stringify({ status: 'pending' }), { status: 200 });
  await assert.rejects(
    pollVideo('https://openrouter.ai/x', { apiKey: 'k', fetchImpl: pending, sleep: async () => {}, now: () => (t += 1000), timeoutMs: 3000 }),
    /timed out/,
  );
});
