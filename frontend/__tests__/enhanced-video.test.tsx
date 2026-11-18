import {beforeEach,describe,it,expect,vi} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {VideoQualityForm} from '../components/admin/video-quality-form';
const m=vi.hoisted(()=>({requireAdmin:vi.fn(),createClient:vi.fn(),sessionClient:vi.fn(),rpc:vi.fn(),from:vi.fn(),fail:false}));
vi.mock('../lib/server/require-admin',()=>({requireAdmin:m.requireAdmin}));
vi.mock('../lib/supabase/server',()=>({createClient:m.sessionClient}));
vi.mock('@supabase/supabase-js',()=>({createClient:m.createClient}));
const id='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{
 vi.clearAllMocks();m.fail=false;
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='fake-test-key';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fake-public-key';
 m.requireAdmin.mockResolvedValue({id,role:'desk_editor'});
 m.rpc.mockReturnValue({maybeSingle:async()=>({data:{id,status:'published',published_at:'2026-11-16T00:00:00Z'},error:null})});
 m.sessionClient.mockResolvedValue({rpc:m.rpc});
 m.from.mockImplementation((table:string)=>{
  const data=table==='video_generation_jobs'?[{status:'processing',created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]:table==='video_delivery_outbox'?[{status:'needs_reconciliation',platform:'youtube',created_at:'2020-01-01'}]:table==='articles'?null:[];
  const chain:Record<string,unknown>={};
  for(const method of ['select','order','gte','in','eq'])chain[method]=()=>chain;
  chain.limit=async()=>({data,error:m.fail?{message:'SECRET database detail'}:null});
  chain.maybeSingle=async()=>({data,error:null});return chain;
 });
 m.createClient.mockReturnValue({from:m.from});
});
async function approve(origin='https://example.test'){
 const {POST}=await import('../app/api/admin/approve/route');
 return POST(new Request('https://example.test/api/admin/approve',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({id,note:'পরীক্ষা করে অনুমোদন'})}));
}
describe('enhanced video editorial and operations surfaces',()=>{
 it('rejects cross-origin editorial publishing before any privileged write',async()=>{const r=await approve('https://attacker.test');expect(r.status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
 it('requires authenticated editor in the route itself, not only middleware',async()=>{m.requireAdmin.mockResolvedValue(null);const r=await approve();expect(r.status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
 it('records editorial instruction with the user JWT RPC, not manufactured service-role flags',async()=>{const r=await approve();expect(r.status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('approve_reporter_article',{p_article_id:id,p_note:'পরীক্ষা করে অনুমোদন'});});
 it('monitor is editor-only and does not instantiate an admin client for public callers',async()=>{m.requireAdmin.mockResolvedValue(null);const {GET}=await import('../app/api/admin/video-pipeline/route');const r=await GET(new Request('https://example.test/api/admin/video-pipeline'));expect(r.status).toBe(403);expect(m.createClient).not.toHaveBeenCalled();});
 it('monitor reports stale delivery/reconciliation and sends no secrets or cacheable response',async()=>{const {GET}=await import('../app/api/admin/video-pipeline/route');const r=await GET(new Request('https://example.test/api/admin/video-pipeline'));const body=await r.json();expect(r.status).toBe(200);expect(body.alerts).toContain('PROVIDER_RECONCILIATION_REQUIRED');expect(body.alerts).toContain('OUTBOX_OLDER_THAN_30_MINUTES');expect(r.headers.get('Cache-Control')).toBe('no-store');expect(JSON.stringify(body)).not.toContain('fake-test-key');});
 it('monitor does not return misleading all-green status when a query fails',async()=>{m.fail=true;const {GET}=await import('../app/api/admin/video-pipeline/route');const r=await GET(new Request('https://example.test/api/admin/video-pipeline'));expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('SECRET');});
 it('editorial UI requires a note and an explicit decision without three-source JSON',()=>{const html=renderToStaticMarkup(<VideoQualityForm jobId={id} videoHash={'a'.repeat(64)} scriptHash={'b'.repeat(64)} durationSec={60}/>);expect(html).toContain('সম্পাদকের সিদ্ধান্ত');expect(html).toContain('disabled');expect(html).not.toContain('claims');expect(html).toContain('বাইরের তিনটি সংবাদমাধ্যমের সূত্র বাধ্যতামূলক নয়');});
});

describe('native Admin/Studio editorial bearer context',()=>{
 it('allows no-Origin native clients only after server-verified user and profile',async()=>{
  const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{role:'desk_editor'},error:null})};
  const getUser=vi.fn().mockResolvedValue({data:{user:{id,email:'editor@example.test'}},error:null});
  m.createClient.mockReturnValue({auth:{getUser},from:()=>chain});
  const {editorialContext}=await import('../lib/server/editorial-context');
  const result=await editorialContext(new Request('https://example.test/api/admin/approve',{method:'POST',headers:{Authorization:'Bearer fixture-native-jwt'}}));
  expect(result.actor.id).toBe(id);expect(getUser).toHaveBeenCalledWith('fixture-native-jwt');expect(m.requireAdmin).not.toHaveBeenCalled();
 });
 it('does not trust a bearer string, body UID or client role without user verification',async()=>{
  m.createClient.mockReturnValue({auth:{getUser:async()=>({data:{user:null},error:{message:'invalid'}})}});
  const {editorialContext}=await import('../lib/server/editorial-context');
  await expect(editorialContext(new Request('https://example.test/api/admin/approve',{method:'POST',headers:{Authorization:'Bearer unverified-jwt'}}))).rejects.toMatchObject({status:401});
 });
 it('no-Origin cookie mutations and cross-origin token requests are blocked',async()=>{const {editorialContext}=await import('../lib/server/editorial-context');for(const headers of [{} as Record<string,string>,{Origin:'https://attacker.test',Authorization:'Bearer fixture'}])await expect(editorialContext(new Request('https://example.test/api/admin/approve',{method:'POST',headers}))).rejects.toMatchObject({status:403});});
});
