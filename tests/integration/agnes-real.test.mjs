// Real Agnes API integration test. Requires AGNES_API_KEY.
// Run: AGNES_API_KEY=... node --test tests/integration/agnes-real.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgnesClient } from '../../ops/worker/agnes-client.mjs';

const KEY = process.env.AGNES_API_KEY;
const skip = !KEY ? 'AGNES_API_KEY missing' : false;

test('agnes create + poll a short clip', { skip, timeout: 360_000 }, async () => {
  const client = createAgnesClient({ apiKey: KEY });
  const id = await client.create({
    prompt: 'a single red apple on a white table, static camera',
    seconds: '4',
    aspect_ratio: '9:16',
  });
  assert.ok(id, 'agnes returned an id');
  const url = await client.poll(id, { intervalMs: 5000, timeoutMs: 300_000 });
  assert.match(url, /^https?:\/\//, 'agnes returned an http(s) url');
  console.log(`[agnes-real] video_id=${id} url=${url}`);
});
