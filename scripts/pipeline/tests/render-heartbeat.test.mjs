import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRenderHeartbeat } from '../render-heartbeat.mjs';
const claim = { article_id: '11111111-1111-4111-8111-111111111111', job_id: '22222222-2222-4222-8222-222222222222', claim_token: '33333333-3333-4333-8333-333333333333' };

test('heartbeat rejects malformed claims before filesystem work', () => {
  assert.throws(() => createRenderHeartbeat({}, { ...claim, job_id: '../../outside' }), /UUID/);
  assert.throws(() => createRenderHeartbeat({}, claim, { intervalMs: 0 }), /timing/);
});
test('heartbeat coalesces overlapping renewals', async () => {
  let calls = 0; let resolve;
  const heartbeat = createRenderHeartbeat({ rpc: () => { calls++; return new Promise((done) => { resolve = done; }); } }, claim);
  const first = heartbeat.renew(); const second = heartbeat.renew();
  assert.equal(first, second); assert.equal(calls, 1);
  resolve({ data: true, error: null });
  await first; await heartbeat.stop();
  assert.equal(heartbeat.signal.aborted, false);
});
for (const result of [{ data: false }, { data: null, error: { code: 'PGRST202', message: 'Do not log raw RPC error' } }]) {
  test('heartbeat fails closed on rejected ownership or missing RPC', async () => {
    const heartbeat = createRenderHeartbeat({ rpc: async () => result }, claim);
    await assert.rejects(heartbeat.renew(), { code: 'RENDER_LEASE_LOST' });
    assert.ok(heartbeat.signal.aborted);
    await assert.rejects(heartbeat.renew(), /lease/);
    await heartbeat.stop();
  });
}
test('heartbeat bounds a hung RPC and aborts render work', async () => {
  const heartbeat = createRenderHeartbeat({ rpc: () => new Promise(() => {}) }, claim, { timeoutMs: 10 });
  await assert.rejects(heartbeat.renew(), { code: 'RENDER_LEASE_LOST' });
  assert.ok(heartbeat.signal.aborted);
  await heartbeat.stop();
});
test('periodic heartbeat keeps running during asynchronous work and stops cleanly', async () => {
  let calls = 0;
  const heartbeat = createRenderHeartbeat({ rpc: async () => { calls++; return { data: true }; } }, claim, { intervalMs: 5 });
  heartbeat.start(); heartbeat.start();
  await sleep(30); await heartbeat.stop();
  assert.ok(calls >= 1);
  const count = calls; await sleep(20); assert.equal(calls, count);
  await assert.rejects(heartbeat.renew(), /stopped/);
});
test('periodic heartbeat catches fulfilled Supabase errors without unhandled rejections', async () => {
  const heartbeat = createRenderHeartbeat({ rpc: async () => ({ data: null, error: { code: 'lost' } }) }, claim, { intervalMs: 5 });
  heartbeat.start(); await sleep(30);
  assert.ok(heartbeat.signal.aborted); await heartbeat.stop();
});
