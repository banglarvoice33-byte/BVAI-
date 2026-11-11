import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function isCoverageSlot(now=new Date()) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dhaka',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return parts.minute==='17' && [7,9,11,12,13,15,17,19,21,23].includes(Number(parts.hour));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.env.BVAI_VIDEO_SCHEDULER_OWNER!=='termux')throw new Error('Local scheduler disabled: BVAI_VIDEO_SCHEDULER_OWNER must be termux');
 if(process.env.ENABLE_VIDEO_AUTOMATION==='true' && isCoverageSlot()) {
  try{execFileSync('bash',[fileURLToPath(new URL('../../run-bvai.sh',import.meta.url))],{stdio:'inherit',env:process.env});}catch(error){process.exitCode=error.status || 1;}
 }
}
