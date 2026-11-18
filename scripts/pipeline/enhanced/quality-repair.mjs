// Bounded deterministic repair. Every repaired output must pass the SAME original inspector.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { measureAudioAsync, loudnormFilter } from '../audio-qc.mjs';
import { MASTER_VIDEO_FILTER, MASTER_COLOR_ARGS } from '../video-contract.mjs';
const run=promisify(execFile);
export function repairAction(error) {
  if(error?.code==='RENDER_LEASE_LOST' || /claim|symlink|path must|UUID|script_binding|rights|source_credit/i.test(error?.message || ''))return null;
  if(/Audio outside|loudness|loudnorm/i.test(error?.message || ''))return 'normalize_audio';
  if(/Invalid delivery master/i.test(error?.message || ''))return 'reencode_master';
  return null; // Unknown failures are not papered over by retries.
}
export async function repairFile(manifest,action,{signal}={}) {
  if(!['normalize_audio','reencode_master'].includes(action))throw new Error('repair_action_invalid');
  const file=manifest.video_path;
  const repaired=path.join(path.dirname(file),'repair-output.mp4');
  const measured=await measureAudioAsync(file,undefined,{signal});
  const args=['-nostdin','-y','-v','error','-i',file,'-map','0:v:0','-map','0:a:0','-map_metadata','-1'];
  if(action==='normalize_audio')args.push('-c:v','copy');
  else args.push('-vf',`scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,${MASTER_VIDEO_FILTER}`,'-c:v','libx264','-preset','fast','-crf','20',...MASTER_COLOR_ARGS);
  args.push('-af',loudnormFilter(measured),'-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',repaired);
  try {
    await run('ffmpeg',args,{timeout:240000,maxBuffer:2*1024*1024,signal});
    fs.renameSync(repaired,file); // Same-filesystem atomic replacement; approvals are made only after this.
  }finally{fs.rmSync(repaired,{force:true});}
}
export async function inspectWithRepair(manifest,{inspect,repair=repairFile,beat=async()=>{},signal,maxAttempts=3,onEvent=()=>{}}={}) {
  if(typeof inspect!=='function' || !Number.isInteger(maxAttempts) || maxAttempts<1 || maxAttempts>3)throw new Error('repair_budget_invalid');
  const history=[];
  for(let attempt=1;attempt<=maxAttempts;attempt++) {
    await beat(); if(signal?.aborted)throw signal.reason;
    try {
      const result=await inspect(manifest);
      await beat();
      return {result,history};
    }catch(error){
      const action=repairAction(error);
      history.push({attempt,action:action || 'escalate',status:'failed'});
      await onEvent({type:'qc_attempt_failed',attempt,action:action || 'escalate'});
      if(!action || attempt===maxAttempts) {error.code=error.code || (action ? 'QUALITY_REPAIR_EXHAUSTED' : 'QUALITY_UNCLASSIFIED');error.repair_history=history;throw error;}
      await repair(manifest,action,{signal});
      await beat();
    }
  }
}
