// Best-effort operational events only. Editorial authorization remains transactional SQL.
const allowed=new Set(['render_started','render_completed','quality_repair_attempt','quality_repair_escalated']);
export async function emitPipelineEvent(db,{jobId,articleId,type,details={}},warn=console.warn){
 if(!allowed.has(type))throw Error('pipeline_event_type_invalid');
 const safe={};
 for(const key of ['attempt','action','repairs','duration_sec'])if(typeof details[key]==='string'||Number.isFinite(details[key]))safe[key]=typeof details[key]==='string'?details[key].slice(0,80):details[key];
 try{
  let query=db.from('video_pipeline_events').insert({job_id:jobId,article_id:articleId,event_type:type,details:safe});
  if(typeof query.abortSignal==='function')query=query.abortSignal(AbortSignal.timeout(3000));
  const {error}=await query;
  if(error)throw Error('event_write_failed');
  return true;
 }catch{warn('PIPELINE_TELEMETRY_UNAVAILABLE');return false;}
}
