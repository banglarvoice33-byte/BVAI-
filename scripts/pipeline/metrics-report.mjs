// Read-only pipeline metrics + alert report from the phase-2 views. Exit codes: 0 = no alerts, 1 = warning(s), 2 = critical,
// 3 = could not read (never treated as healthy). Optional webhook (BVAI_ALERT_WEBHOOK_URL, https) with per-alert dedupe.
// "Costs" are request/character counters (AI gateway, TTS), NOT currency; verified publication = outbox result carrying
// verified_at + provider id, never merely "job succeeded".
import {createHash} from 'node:crypto';
import fs from 'node:fs';
export const SEVERITY_RANK={warning:1,critical:2};
export function exitCodeFor(alerts) {
  return alerts.reduce((n,a)=>Math.max(n,SEVERITY_RANK[a.severity]||2),0);
}
export const alertId=a=>createHash('sha256').update([a.severity,a.code,a.subject].join('\u0000')).digest('hex').slice(0,16);
export function dedupe(alerts,state,{now=Date.now(),ttlMs=6*3600*1000}={}) {
  const fresh=[];const next={};
  for(const a of alerts){const id=alertId(a);const seen=state[id];next[id]=seen&&now-seen<ttlMs?seen:now;if(!seen||now-seen>=ttlMs)fresh.push(a);}
  return {fresh,next};
}
export function render({summary,delivery,sources,alerts}) {
  const L=[];
  L.push('BVAI pipeline report');
  L.push(`ingestion last ok: ${summary.last_successful_ingestion_at||'never'} | articles 24h: ${summary.articles_published_24h} | stories skipped 24h: ${summary.stories_skipped_24h} (duplicate ${summary.stories_duplicate_24h})`);
  L.push(`video jobs 24h: ${summary.video_jobs_24h} | rendered ${summary.video_jobs_rendered_24h} | failed ${summary.video_jobs_failed_24h} (captions ${summary.caption_failures_24h}, tts ${summary.tts_failures_24h}, render ${summary.render_failures_24h}, duplicate ${summary.video_duplicate_rejections_24h})`);
  L.push(`usage counters: AI requests ${summary.ai_requests_24h} (failed ${summary.ai_failures_24h}), AI chars ${summary.ai_chars_24h}, TTS chars this month ${summary.tts_chars_this_month}  [counters, not currency]`);
  for(const d of delivery)L.push(`delivery ${d.platform}: verified24h ${d.verified_24h} | queued ${d.queued} retrying ${d.retrying} reconciling ${d.needs_reconciliation} dead ${d.dead_letter} | oldest pending ${d.oldest_pending_minutes??'-'}m`);
  const stale=sources.filter(s=>s.stale);
  L.push(`sources: ${sources.length} total, ${stale.length} stale${stale.length?' → '+stale.map(s=>s.source_name).join(', '):''}`);
  L.push(alerts.length?'ALERTS:\n'+alerts.map(a=>`  [${a.severity}] ${a.code} ${a.subject}: ${a.detail}`).join('\n'):'ALERTS: none');
  return L.join('\n');
}
export async function collect(db) {
  const one=async(q)=>{const r=await q;if(r.error)throw new Error('metrics_unavailable: '+String(r.error.message).slice(0,120));return r.data;};
  const [summary,delivery,sources,alerts]=await Promise.all([
    one(db.from('media_pipeline_summary').select('*').single()),one(db.from('media_delivery_health').select('*')),
    one(db.from('media_source_freshness').select('*')),one(db.from('media_alerts').select('*'))]);
  return {summary,delivery:delivery||[],sources:sources||[],alerts:alerts||[]};
}
export async function notify(url,text,fetchImpl=fetch) {
  if(!/^https:\/\//.test(url||''))throw new Error('webhook must be https');
  const r=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:text.slice(0,3500)}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('webhook HTTP '+r.status);
}
export async function run({db,env=process.env,fetchImpl=fetch,out=console.log}={}) {
  let report;
  try{report=await collect(db);}catch(e){out(String(e.message));return 3;}
  out(render(report));
  const code=exitCodeFor(report.alerts);
  const url=env.BVAI_ALERT_WEBHOOK_URL;
  if(url && report.alerts.length) {
    const file=env.BVAI_ALERT_STATE||'.bvai-alert-state.json';
    let state={};try{state=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    const {fresh,next}=dedupe(report.alerts,state);
    if(fresh.length){try{await notify(url,render({...report,alerts:fresh}),fetchImpl);}catch(e){out('alert delivery failed: '+e.message);return Math.max(code,2);}}
    fs.writeFileSync(file,JSON.stringify(next),{mode:0o600});
  }
  return code;
}
if(process.argv[1] && import.meta.url===new URL(process.argv[1],'file:').href) {
  const {createClient}=await import('@supabase/supabase-js');
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  process.exitCode=await run({db});
}
