import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgnesClient } from '../ops/worker/agnes-client.mjs';

test('agnes client rejects without apiKey', () => {
  assert.throws(() => createAgnesClient({}), /AGNES_API_KEY/);
});

test('agnes create returns video_id', async () => {
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    assert.match(String(url), /\/videos$/);
    assert.equal(JSON.parse(opts.body).model, 'agnes-video-2.5-flash');
    return new Response(JSON.stringify({ video_id: 'vid-1' }), { status: 200 });
  };
  try {
    const c = createAgnesClient({ apiKey: 'k' });
    assert.equal(await c.create({ prompt: 'x' }), 'vid-1');
  } finally { global.fetch = orig; }
});

test('agnes poll succeeds', async () => {
  const orig = global.fetch;
  let n = 0;
  global.fetch = async () => new Response(JSON.stringify(++n < 2 ? { status: 'processing' } : { status: 'completed', url: 'https://x/y.mp4' }), { status: 200 });
  try {
    const c = createAgnesClient({ apiKey: 'k' });
    assert.equal(await c.poll('vid-1', { intervalMs: 5 }), 'https://x/y.mp4');
  } finally { global.fetch = orig; }
});
