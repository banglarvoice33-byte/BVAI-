import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({requireAdmin:vi.fn(),createAdmin:vi.fn(),createSession:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('../lib/server/require-admin',()=>({requireAdmin:mocks.requireAdmin}));
vi.mock('@supabase/supabase-js',()=>({createClient:mocks.createAdmin}));
vi.mock('../lib/supabase/server',()=>({createClient:mocks.createSession}));
const id='11111111-1111-4111-8111-111111111111';
const request=(origin='https://example.test',body:unknown={id,note:'সম্পাদকের নির্দেশ'})=>new Request('https://example.test/api/admin/approve',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{
 vi.clearAllMocks();process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='server-only-fixture';
 mocks.requireAdmin.mockResolvedValue({id,role:'desk_editor'});
 mocks.createAdmin.mockReturnValue({from:mocks.from});
 mocks.createSession.mockResolvedValue({rpc:mocks.rpc});
 mocks.rpc.mockReturnValue({maybeSingle:async()=>({data:{id,status:'published',published_at:'2026-11-16T00:00:00Z'},error:null})});
 mocks.from.mockImplementation(()=>{
  const query:{[key:string]:unknown}={};
  for(const method of ['select','eq','order','gte','in'])query[method]=()=>query;
  query.limit=async()=>({data:[],error:null});
  query.maybeSingle=async()=>({data:null,error:null});
  return query;
 });
});
describe('reporter editorial API defense in depth',()=>{
 it('rejects cross-origin writes before consulting credentials',async()=>{const {POST}=await import('../app/api/admin/approve/route');const r=await POST(request('https://attacker.example'));expect(r.status).toBe(403);expect(mocks.requireAdmin).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();});
 it('requires actual editor session even if middleware is bypassed',async()=>{mocks.requireAdmin.mockResolvedValue(null);const {POST}=await import('../app/api/admin/approve/route');expect((await POST(request())).status).toBe(403);expect(mocks.createAdmin).not.toHaveBeenCalled();});
 it('rejects non-UUID article identifiers',async()=>{const {POST}=await import('../app/api/admin/approve/route');expect((await POST(request('https://example.test',{id:'not-a-uuid'}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('records approval through authenticated database RPC, not a forged service-role human flag',async()=>{const {POST}=await import('../app/api/admin/approve/route');const r=await POST(request());expect(r.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('approve_reporter_article',{p_article_id:id,p_note:'সম্পাদকের নির্দেশ'});expect((await r.json()).status).toBe('published');});
});
describe('read-only operational monitoring',()=>{
 it('rejects an unauthenticated reader',async()=>{mocks.requireAdmin.mockResolvedValue(null);const {GET}=await import('../app/api/admin/video-pipeline/route');expect((await GET(new Request('https://example.test/api/admin/video-pipeline'))).status).toBe(403);expect(mocks.createAdmin).not.toHaveBeenCalled();});
 it('returns no-store operational coverage with no server credentials',async()=>{const {GET}=await import('../app/api/admin/video-pipeline/route');const r=await GET(new Request('https://example.test/api/admin/video-pipeline'));const body=await r.json();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(body.coverage.jobs_limit).toBe(2000);expect(JSON.stringify(body)).not.toContain('server-only-fixture');expect(body.scope).toContain('not independent proof');});
 it('does not label failed database reads as healthy empty queues',async()=>{mocks.from.mockImplementation(()=>{const q:{[key:string]:unknown}={};for(const m of ['select','order','gte','in'])q[m]=()=>q;q.limit=async()=>({data:null,error:{message:'sensitive internal database detail'}});return q;});const {GET}=await import('../app/api/admin/video-pipeline/route');const r=await GET(new Request('https://example.test/api/admin/video-pipeline'));expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('sensitive');});
});
