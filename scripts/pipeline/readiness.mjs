import {createClient} from '@supabase/supabase-js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
/** Read-only deployment probe. No queue claim, provider post, DDL or enable flag. */
export async function readiness(env=process.env) {
  const checks=[];
  const add=(name,ok,detail)=>checks.push({name,ok,detail});
  for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SITE_URL'])add(key,Boolean(env[key]),env[key]?'configured (value hidden)':'missing');
  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)return {ok:false,checks};
  const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  for(const [table,column] of [['video_pipeline_events','id'],['video_experiments','id'],['video_experiment_events','id'],['articles','id'],['video_generation_jobs','id'],['video_quality_approvals','job_id'],['video_delivery_assets','video_id'],['video_delivery_outbox','id'],['video_story_reservations','job_id'],['video_broll_reservations','job_id'],['social_posts','claim_token'],['social_dispatch_readiness_v2','platform']]) {
    const {error}=await db.from(table).select(column).limit(0);
    add(table,!error,error?'contract unavailable':'readable');
  }
  const {error:gateError}=await db.rpc('video_gate_basis',{p_article_id:'00000000-0000-0000-0000-000000000000'});
  add('video_gate_basis',!gateError,gateError?'RPC unavailable':'read-only NULL article check passed');
  const {data:bucket,error:bucketError}=await db.storage.getBucket('reels');
  add('private_reels',!bucketError && bucket?.public===false,'must be private');
  const start=new Date(Date.now()-86400000).toISOString();
  for(const [table,filter,column] of [['articles','published','status'],['videos','published','status'],['video_delivery_outbox','succeeded','status']]) {
    const {count,error}=await db.from(table).select('*',{count:'exact',head:true}).eq(column,filter).gte('created_at',start);
    add(`${table}_last24h`,!error,error?'count unavailable':String(count));
  }
  add('no_legacy_publisher',env.VIDEO_DISTRIBUTION_WORKER_ENABLED!=='true','legacy publisher must be disabled');
  return {ok:checks.every(c=>c.ok),scope:'read-only contracts, not end-to-end publication certification',checks};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  readiness().then(result=>{console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:2;}).catch(()=>{console.error('Readiness check failed; inspect connectivity/configuration locally. No secret values printed.');process.exitCode=2;});
}
