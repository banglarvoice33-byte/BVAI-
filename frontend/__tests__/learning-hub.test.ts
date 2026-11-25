import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn(), gateway: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('../lib/ai-gateway', () => ({ callAiGateway: mocks.gateway }));
import { POST } from '../app/api/learning-hub/route';
const send = (body: unknown, headers: Record<string,string> = {}) => POST(new Request('https://example.test/api/learning-hub', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

describe('text assistant API quota boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'session-account' } } });
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
    mocks.abortSignal.mockResolvedValue({ data: 0, error: null });
  });
  it('validates unauthenticated, oversized, and cross-site requests early', async () => {
    expect((await send({ question: 'x'.repeat(33_000) })).status).toBe(413);
    expect((await send({ question: 'Hi' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await send({ question: 'Hi' })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('charges greeting and trusts only the verified account id', async () => {
    const res = await send({ question: 'Hello', userId: 'forged' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({ remaining: 0, intent: 'greeting' });
    expect(mocks.rpc).toHaveBeenCalledWith('consume_learning_hub_question', { p_user_id: 'session-account' });
  });
  it('does not call providers once the cap is reached or quota is unavailable', async () => {
    mocks.abortSignal.mockResolvedValueOnce({ data: -1, error: null });
    const res = await send({ question: 'ক্রিকেট ম্যাচের খবর' });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ remaining: 0 });
    mocks.abortSignal.mockResolvedValueOnce({ data: null, error: { code: 'missing' } });
    expect((await send({ question: 'ক্রিকেট ম্যাচের খবর' })).status).toBe(503);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
});
