import fs from 'node:fs';
import path from 'node:path';
/** Recover only terminal local state, before taking another DB claim.
 * Never delete source media, mutate a live lease, or guess after an ambiguous upload.
 */
export async function archiveTerminalClaim(db,{root,backupRoot}={}) {
 const claimFile=path.join(root,'claim.json');
 if(!fs.existsSync(claimFile))return;
 if(fs.existsSync(path.join(root,'manifest.json')))throw new Error('Recover/upload pending manifest before a new render');
 const claim=JSON.parse(fs.readFileSync(claimFile,'utf8'));
 if(!/^[0-9a-f-]{36}$/i.test(claim.job_id || ''))throw new Error('Invalid recovery job ID');
 const {data:job,error}=await db.from('video_generation_jobs').select('status,claim_token,lease_expires_at').eq('id',claim.job_id).single();
 if(error || job.claim_token!==claim.claim_token)throw new Error('Local claim cannot be reconciled safely');
 if(!['failed','cancelled','completed','needs_review'].includes(job.status))throw new Error('Prior render still owns a live/ambiguous lease; inspect before continuing');
 const dest=path.join(backupRoot,`render-${claim.job_id}-${Date.now()}`);
 fs.mkdirSync(dest,{recursive:true,mode:0o700});
 const folder=path.join(root,claim.job_id);
 if(fs.existsSync(folder)) {
  if(fs.lstatSync(folder).isSymbolicLink())throw new Error('Unsafe recovery folder');
  fs.renameSync(folder,path.join(dest,claim.job_id));
 }
 fs.renameSync(claimFile,path.join(dest,'claim.json'));
 console.log('Archived verified terminal local claim; a new eligible story may now be claimed.');
}
