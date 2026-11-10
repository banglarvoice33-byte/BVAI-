// Offline adapter contract: callers must supply observations from actual ingestion,
// not last_probe_at. No credentials, signed URLs, checkpoints, IDs or raw errors emitted.
const finite=x=>Number.isFinite(x)&&x>=0;
const age=(value,now)=>{const t=Date.parse(value);return Number.isFinite(t)&&t<=now?(now-t)/1000:null;};
export function metrics(s,{now=Date.now(),sourceMaxAge=1800,outboxMaxAge=3600}={}){
  if(!s||!Array.isArray(s.sources)||!Array.isArray(s.outbox))throw Error('Snapshot arrays required');
  const lines=[],alerts=[];
  const emit=(name,value)=>{if(!finite(value))throw Error('Metric value invalid');lines.push(`bvai_${name} ${value}`);};
  let stale=0,unknown=0;
  for(const source of s.sources){if(source.enabled!==true)continue;const seconds=age(source.last_successful_ingestion_at,now);if(seconds===null)unknown++;else if(seconds>sourceMaxAge)stale++;}
  emit('sources_stale',stale);emit('sources_ingestion_unknown',unknown);
  if(stale||unknown)alerts.push('SOURCE_INGESTION_STALE_OR_UNKNOWN');
  for(const key of ['stories_rejected_total','stories_duplicate_total','generation_cost_usd_total','render_failures_total','caption_failures_total']){
    if(s[key]===undefined){alerts.push('METRIC_MISSING_'+key.toUpperCase());continue;}emit(key,s[key]);
  }
  for(const status of ['queued','processing','retrying','needs_reconciliation']){
    const rows=s.outbox.filter(x=>x.status===status);const ages=rows.map(x=>age(x.created_at,now));
    emit(`outbox_${status}_count`,rows.length);emit(`outbox_${status}_oldest_seconds`,Math.max(0,...ages.filter(x=>x!==null)));
    if(ages.some(x=>x===null||x>outboxMaxAge))alerts.push('OUTBOX_'+status.toUpperCase()+'_STALE_OR_UNKNOWN');
  }
  for(const platform of ['website','youtube','facebook','instagram','tiktok']){
    const events=s.publications?.filter(x=>x.platform===platform)||[];
    const verified=events.filter(x=>x.public_visibility_verified===true&&x.verified_by==='independent_read'&&age(x.verified_at,now)!==null);
    emit(`${platform}_publications_independently_verified_count`,verified.length);
    const last=Math.max(0,...verified.map(x=>Date.parse(x.verified_at)/1000));emit(`${platform}_last_verified_publication_timestamp_seconds`,last);
  }
  return {prometheus:lines.join('\n')+'\n',alerts};
}
