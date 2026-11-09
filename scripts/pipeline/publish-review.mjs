// Explicit human approval of a version-2 reviewed asset, with optional durable outbox.
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {assertEditorial,refreshEvidence} from './source-evidence.mjs';
import {deliveryTargets} from './delivery-worker.mjs';
const id=process.argv[2];
const distribute=process.argv.includes('--approve-distribute');
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '') || (!distribute && !process.argv.includes('--approve-website'))) {
  console.error('Usage: node --env-file=.env scripts/pipeline/publish-review.mjs JOB_UUID --approve-website|--approve-distribute');process.exitCode=1;
} else {
  try {
    const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:job,error:jobError}=await db.from('video_generation_jobs').select('id,article_id,video_id,status,claim_token,render_path').eq('id',id).single();
    if(jobError)throw new Error('Generation job unavailable');
    if(!['needs_review','completed'].includes(job.status))throw new Error('Job is not reviewable/completed');
    const {data:asset,error:assetError}=await db.from('video_delivery_assets').select('sha256,manifest').eq('job_id',id).single();
    if(assetError)throw new Error('Version-2 asset missing. Legacy review assets require audited reconciliation; do not invent a reservation.');
    const {data:article,error:articleError}=await db.from('articles').select('*').eq('id',job.article_id).single();
    if(articleError)throw new Error('Article unavailable');
    assertEditorial(article,distribute?'distribute':'website');
    const manifest={...asset.manifest,evidence:await refreshEvidence(article,'website')};
    const targets=distribute?deliveryTargets():[];
    if(distribute&&!targets.length)throw new Error('Configure VIDEO_DELIVERY_PLATFORMS and target account IDs');
    const bucket=db.storage.from('reels');
    const {data:remote,error:downloadError}=await bucket.download(job.render_path);
    if(downloadError)throw new Error('Stored render unavailable');
    const bytes=Buffer.from(await remote.arrayBuffer());
    if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256 || bytes.length!==manifest.size_bytes)throw new Error('Stored render checksum/size mismatch');
    const {data:signed,error:signError}=await bucket.createSignedUrl(job.render_path,3600);
    if(signError)throw new Error('Signing failed');
    const {data:result,error}=await db.rpc('finalize_media_delivery',{p_job_id:job.id,p_article_id:job.article_id,p_claim_token:job.claim_token,p_path:job.render_path,p_signed_url:signed.signedUrl,p_duration_sec:Math.ceil(manifest.render_duration),p_sha256:asset.sha256,p_size_bytes:bytes.length,p_publish:true,p_manifest:manifest,p_targets:targets});
    if(error)throw new Error('Approval transaction failed: '+error.message);
    console.log(JSON.stringify({result,targets:targets.map(t=>t.platform)}));
    console.log('Approval committed. Provider publication remains a separately verified delivery stage.');
  } catch(error){console.error(error.message);process.exitCode=1;}
}
