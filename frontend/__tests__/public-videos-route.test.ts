import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ from: vi.fn(), sign: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from, storage: { from: () => ({ createSignedUrl: mocks.sign }) } }) }));

function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const key of ['select','eq','in','not','order','limit']) chain[key] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve);
  return chain;
}
const videos = [
  { id:'private-video',article_id:'article-1',title_bn:'বাংলা সংবাদ',status:'published',video_url:'expired-link',duration_sec:40 },
  { id:'legacy-video',title_bn:'পুরোনো সংবাদ',status:'published',video_url:'https://example.org/public.mp4',duration_seconds:20 },
];
describe('public website video delivery', () => {
  beforeEach(() => {
    vi.resetModules(); mocks.from.mockReset(); mocks.sign.mockReset();
    process.env.SUPABASE_URL='https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY='test-server-key';
  });
  afterEach(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });
  it('refreshes private signed URLs and preserves legacy public playback', async () => {
    mocks.from.mockImplementation((table: string) => query(table==='videos' ? {data:videos,error:null} : {data:[{video_id:'private-video',render_path:'article/job.mp4'}],error:null}));
    mocks.sign.mockResolvedValue({data:{signedUrl:'https://example.org/fresh-signed.mp4'},error:null});
    const { GET }=await import('../app/api/public/videos/route');
    const response=await GET(new Request('https://site.example/api/public/videos'));
    const payload=await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(payload.videos[0].video_url).toContain('fresh-signed');
    expect(payload.videos[1].video_url).toContain('public.mp4');
    expect(mocks.sign).toHaveBeenCalledWith('article/job.mp4',3600);
  });
  it('isolates an unavailable private asset instead of hiding every video', async () => {
    mocks.from.mockImplementation((table: string) => query(table==='videos' ? {data:videos,error:null} : {data:[{video_id:'private-video',render_path:'missing.mp4'}],error:null}));
    mocks.sign.mockResolvedValue({data:null,error:{message:'missing'}});
    const { GET }=await import('../app/api/public/videos/route');
    const payload=await (await GET(new Request('https://site.example/api/public/videos'))).json();
    expect(payload.videos).toHaveLength(1);
    expect(payload.videos[0].id).toBe('legacy-video');
  });
  it('returns 503 rather than exposing backend credentials on query error', async () => {
    mocks.from.mockReturnValue(query({data:null,error:{message:'sensitive backend detail'}}));
    const { GET }=await import('../app/api/public/videos/route');
    const response=await GET(new Request('https://site.example/api/public/videos'));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');
  });
});
