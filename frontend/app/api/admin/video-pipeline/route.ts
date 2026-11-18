import {NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {editorialContext,EditorialAuthError} from '@/lib/server/editorial-context';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const headers={'Cache-Control':'no-store'};
 try{
  await editorialContext(request,{mutation:false});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return NextResponse.json({error:'pipeline_unconfigured'},{status:503,headers});
  const db=createClient(url,key,{auth:{persistSession:false}});
  const since=new Date(Date.now()-86400000).toISOString();
  const [events,jobs,delivery,experiments]=await Promise.all([
   db.from('video_pipeline_events').select('id,job_id,article_id,event_type,created_at').order('created_at',{ascending:false}).limit(50),
   db.from('video_generation_jobs').select('status,created_at,updated_at').gte('created_at',since).limit(2000),
   db.from('video_delivery_outbox').select('status,platform,created_at').in('status',['queued','processing','retrying','needs_reconciliation','dead_letter']).order('created_at',{ascending:true}).limit(2000),
   db.from('video_experiments').select('id,status,created_at').order('created_at',{ascending:false}).limit(50),
  ]);
  if([events,jobs,delivery,experiments].some(r=>r.error))return NextResponse.json({error:'pipeline_contract_unavailable'},{status:503,headers});
  const counts:Record<string,number>={};
  for(const job of jobs.data||[])counts[job.status]=(counts[job.status]||0)+1;
  const alerts:string[]=[];
  if(delivery.data?.some(q=>q.status==='needs_reconciliation'))alerts.push('PROVIDER_RECONCILIATION_REQUIRED');
  if(delivery.data?.some(q=>q.status==='dead_letter'))alerts.push('DELIVERY_DEAD_LETTER');
  if(jobs.data?.some(q=>q.status==='processing' && Date.now()-Date.parse(q.updated_at)>15*60000))alerts.push('RENDER_POSSIBLY_STALE');
  if(delivery.data?.some(q=>Date.now()-Date.parse(q.created_at)>30*60000))alerts.push('OUTBOX_OLDER_THAN_30_MINUTES');
  return NextResponse.json({as_of:new Date().toISOString(),window_hours:24,jobs:counts,alerts,events:events.data,delivery:delivery.data,experiments:experiments.data,coverage:{jobs_limit:2000,delivery_limit:2000,possibly_truncated:jobs.data?.length===2000||delivery.data?.length===2000},scope:'Operational status, not independent proof of public visibility or broadcast quality.'},{headers});
 }catch(error){if(error instanceof EditorialAuthError)return NextResponse.json({error:error.message},{status:error.status,headers});return NextResponse.json({error:'pipeline_status_unavailable'},{status:503,headers});}
}
