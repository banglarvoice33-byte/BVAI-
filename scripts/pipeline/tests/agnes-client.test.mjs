import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgnesClient, AgnesApiError, getAgnesKeyCandidates } from '../agnes-client.mjs';
import { agnesSlotSeconds } from '../agnes-visuals.mjs';

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return payload; },
  async text() { return JSON.stringify(payload); },
});

test('Agnes key candidates are ordered and deduplicated', () => {
  assert.deepEqual(
    getAgnesKeyCandidates({ AGNES_API_KEY_1: 'first', AGNES_API_KEY_2: 'first', VIDEO_AGNES_API_KEY_3: 'third', AGNES_API_KEY: 'legacy' }),
    [{ index: 1, key: 'first' }, { index: 3, key: 'third' }],
  );
  assert.deepEqual(getAgnesKeyCandidates({ AGNES_API_KEY: 'legacy' }), [{ index: 1, key: 'legacy' }]);
});

test('Agnes create request uses the Flash contract and string seconds', async () => {
  const calls = [];
  const client = createAgnesClient({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse({ video_id: 'video-123', status: 'queued' });
    },
  });
  assert.equal(await client.createVideoTask({ prompt: 'A factual Bengali news visual in Dhaka.', seconds: 8 }), 'video-123');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://apihub.agnes-ai.com/v1/videos');
  assert.equal(body.model, 'agnes-video-2.5-flash');
  assert.equal(body.seconds, '8');
  assert.equal(body.size, '720P');
  assert.equal(body.aspect_ratio, '9:16');
  assert.equal(body.n, 1);
});

test('Agnes polling always sends model_name and returns the top-level url', async () => {
  const urls = [];
  let attempt = 0;
  const client = createAgnesClient({
    apiKey: 'test-key',
    fetchImpl: async (url) => {
      urls.push(String(url));
      attempt += 1;
      return attempt === 1
        ? jsonResponse({ status: 'in_progress', progress: 35 })
        : jsonResponse({ status: 'completed', url: 'https://cdn.example/video.mp4' });
    },
    sleepImpl: async () => {},
  });
  const result = await client.waitForVideo({ videoId: 'video-123', pollIntervalMs: 1 });
  assert.equal(result.url, 'https://cdn.example/video.mp4');
  assert.match(urls[0], /video_id=video-123/);
  assert.match(urls[0], /model_name=agnes-video-2.5-flash/);
});

test('Agnes retries transient polling failures and eventually succeeds', async () => {
  let calls = 0;
  const sleeps = [];
  const client = createAgnesClient({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ detail: 'busy' }, 429);
      return jsonResponse({ status: 'completed', url: 'https://cdn.example/video.mp4' });
    },
    sleepImpl: async (ms) => sleeps.push(ms),
  });
  await client.waitForVideo({ videoId: 'video-123', pollIntervalMs: 1 });
  assert.equal(calls, 2);
  assert.ok(sleeps.some((ms) => ms >= 1000));
});

test('Agnes rejects invalid Flash settings and unsafe download URLs', async () => {
  await assert.rejects(
    () => createAgnesClient({ apiKey: 'test-key', size: '1080P' }).createVideoTask({ prompt: 'A valid prompt for testing.', seconds: 5 }),
    (error) => error instanceof AgnesApiError && error.statusCode === 400,
  );
  const client = createAgnesClient({ apiKey: 'test-key', fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(() => client.downloadVideo('http://example.com/video.mp4', '/tmp/video.mp4'), AgnesApiError);
});

test('Agnes downloads the response body as a stream and refuses overwrites', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agnes-test-'));
  const output = path.join(dir, 'clip.mp4');
  const client = createAgnesClient({
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      body: Readable.from([Buffer.from('mp4-test-data')]),
    }),
  });
  await client.downloadVideo('https://cdn.example/video.mp4', output);
  assert.equal(await fs.readFile(output, 'utf8'), 'mp4-test-data');
  await assert.rejects(() => client.downloadVideo('https://cdn.example/video.mp4', output));
  await fs.rm(dir, { recursive: true, force: true });
});

test('Agnes scene durations clamp to Flash limits while preserving ordinary measured slots', () => {
  assert.equal(agnesSlotSeconds(3.2), 4);
  assert.equal(agnesSlotSeconds(7.4), 7);
  assert.equal(agnesSlotSeconds(12.8), 12);
  assert.equal(agnesSlotSeconds(Number.NaN), 4);
});
