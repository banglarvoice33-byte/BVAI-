// Stable, privacy-minimizing A/B presentation framework. Never experiment with factual claims or approval gates.
import {createHash} from 'node:crypto';
export function assignVariant(experiment,subjectHash){
 if(!/^[a-f0-9]{64}$/.test(subjectHash || '') || !/^[a-z0-9_-]{1,80}$/.test(experiment?.id || '') || !['draft','running','stopped'].includes(experiment.status))throw Error('experiment_identity_invalid');
 const variants=experiment.variants;
 if(!Array.isArray(variants)||variants.length<2||variants.length>8||new Set(variants.map(v=>v.id)).size!==variants.length||variants.some(v=>!/^[a-z0-9_-]{1,40}$/.test(v.id||'')||!Number.isInteger(v.weight)||v.weight<1)||variants.reduce((n,v)=>n+v.weight,0)!==10000)throw Error('experiment_weights_invalid');
 if(experiment.status!=='running')return {variant:variants[0].id,enrolled:false};
 const bucket=createHash('sha256').update(experiment.id+':'+subjectHash).digest().readUInt32BE(0)%10000;
 let end=0;for(const v of variants){end+=v.weight;if(bucket<end)return {variant:v.id,enrolled:true};}
}
export function wilson(successes,total,z=1.96){
 if(!Number.isSafeInteger(total)||!Number.isSafeInteger(successes)||total<0||successes<0||successes>total)throw Error('experiment_counts_invalid');
 if(total===0)return {rate:null,low:null,high:null};
 const p=successes/total,d=1+z*z/total,c=(p+z*z/(2*total))/d,h=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;
 return {rate:p,low:Math.max(0,c-h),high:Math.min(1,c+h)};
}
export function summarizeExperiment(rows,{minExposures=1000}={}){
 if(!Number.isSafeInteger(minExposures)||minExposures<1)throw Error('experiment_sample_invalid');
 return rows.map(r=>({...r,ctr:wilson(r.clicks,r.exposures),sample_status:r.exposures>=minExposures?'reviewable_not_automatic_winner':'insufficient',caution:'No automatic winner; account for repeated testing, allocation and platform differences.'}));
}
// Server-side integration adapter: caller must generate a stable pseudonymous 64-hex subject ID;
// do not supply IP, email, cookies, names or cross-site identifiers. No anonymous public write RPC.
export async function recordExperiment(db,{experiment,subjectHash,videoId,event,idempotencyKey}){
 const assignment=assignVariant(experiment,subjectHash);
 if(!assignment.enrolled)return assignment;
 if(!['exposure','click','complete'].includes(event)||!/^[a-f0-9]{64}$/.test(idempotencyKey||''))throw Error('experiment_event_invalid');
 const {error}=await db.rpc('record_video_experiment_event',{p_experiment_id:experiment.id,p_subject_hash:subjectHash,p_video_id:videoId,p_variant:assignment.variant,p_event:event,p_event_key:idempotencyKey});
 if(error)throw Error('experiment_recording_unavailable');
 return assignment;
}
