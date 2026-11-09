// Explicit editorial approval for an existing review asset, website ONLY.
// Usage: node --env-file=.env scripts/pipeline/publish-review.mjs JOB_UUID --approve-website
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
const jobId=process.argv[2];
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId || '') || !process.argv.includes('--approve-website')) {
  console.error('Usage: node --env-file=.env scripts/pipeline/publish-review.mjs JOB_UUID --approve-website');
  process.exitCode=1;
} else {
  try {
    if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Server credentials missing');
    const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:job,error:jobError}=await db.from('video_generation_jobs').select('id,article_id,video_id,status,claim_token,render_path').eq('id',jobId).single();
    if(jobError)throw new Error(jobError.message);
    if(job.status==='completed'){console.log('Already completed; no new publication.');}
    else {
      if(job.status!=='needs_review')throw new Error('Job is not awaiting editorial review');
      const {data:asset,error:assetError}=await db.from('video_generation_assets').select('metadata').eq('job_id',jobId).eq('kind','render').single();
      if(assetError)throw new Error(assetError.message);
      const meta=asset.metadata;
      if(meta.bucket!=='reels' || meta.path!==job.render_path)throw new Error('Stored asset contract mismatch');
      const bucket=db.storage.from('reels');
      const {data:remote,error:remoteError}=await bucket.download(job.render_path);
      if(remoteError)throw new Error(remoteError.message);
      const bytes=Buffer.from(await remote.arrayBuffer());
      if(bytes.length!==Number(meta.size_bytes) || createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw new Error('Remote asset integrity mismatch');
      const {data:signed,error:signError}=await bucket.createSignedUrl(job.render_path,3600);
      if(signError)throw new Error(signError.message);
      const {data:result,error}=await db.rpc('finalize_website_video',{
        p_job_id:job.id,p_article_id:job.article_id,p_claim_token:job.claim_token,p_path:job.render_path,
        p_signed_url:signed.signedUrl,p_duration_sec:Number(meta.duration_sec),p_sha256:meta.sha256,
        p_size_bytes:Number(meta.size_bytes),p_publish:true
      });
      if(error)throw new Error(error.message);
      console.log('✅ Editorially approved for website:',JSON.stringify(result));
      console.log('Social APIs were not invoked.');
    }
  } catch(error){console.error('Approval failed:',error.message);process.exitCode=1;}
}
