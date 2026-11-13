import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertEditorial,refreshEvidence} from './source-evidence.mjs';
import {deliverYoutube,deliverFacebook,deliverInstagram,deliverTiktok,youtubeToken,DeliveryError} from './delivery-providers.mjs';
export function deliveryTargets(env=process.env) {
  const platforms=[...new Set((env.VIDEO_DELIVERY_PLATFORMS || '').split(',').map(x=>x.trim()).filter(Boolean))];
  const keys={
    youtube:'YOUTUBE_CHANNEL_ID',
    facebook:'SOCIAL_FACEBOOK_PAGE_ID',
    instagram:'SOCIAL_INSTAGRAM_BUSINESS_ACCOUNT_ID',
    tiktok:'TIKTOK_OPEN_ID'
  };
  return platforms.map(platform=>{
    if(!keys[platform])throw new Error('Unsupported video delivery platform: '+platform);
    const account_id=env[keys[platform]];
    if(!account_id || !/^[a-zA-Z0-9_-]+$/.test(account_id))throw new Error('Configure '+keys[platform]);
    return {platform,account_id};
  });
}
async function secret(db,name,aliases=[]) {
  for(const key of [name,...aliases]) {
    if(process.env[key])return process.env[key];
    const {data:row,error}=await db.from('api_vault').select('key_encrypted').eq('service_name',key).eq('environment','prod').eq('is_active',true).maybeSingle();
    if(!error && row?.key_encrypted) {
      const {data:plain,error:decryptError}=await db.rpc('decrypt_vault_secret',{p_secret_id:row.key_encrypted});
      if(!decryptError && typeof plain==='string' && plain)return plain;
    }
  }
  throw new DeliveryError('Missing credential: '+name,{permanent:true});
}
export function failureStatus(error,checkpoint) {
  if(error.permanent)return 'dead_letter';
  if(error.safeResume || checkpoint.verified_result?.id)return 'retrying';
  if(error.ambiguous || Object.keys(checkpoint).length)return 'needs_reconciliation';
  return 'retrying';
}
export async function runDelivery() {
  if(process.env.VIDEO_DELIVERY_ENABLED==='false'){console.log('Video delivery paused (VIDEO_DELIVERY_ENABLED=false); no provider calls.');return;}
  if(!(process.env.VIDEO_DELIVERY_PLATFORMS||'').trim()){console.log('VIDEO_DELIVERY_PLATFORMS is empty; nothing to deliver.');return;}
  if(process.env.VIDEO_DISTRIBUTION_WORKER_ENABLED==='true')throw new Error('Disable legacy video distribution worker before enabling new outbox');
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  let problems=0;
  for(const target of deliveryTargets()) {
    const {data:rows,error}=await db.rpc('claim_media_delivery',{p_platform:target.platform,p_account_id:target.account_id});
    if(error)throw new Error('Delivery claim: '+error.message);
    const job=rows?.[0];if(!job)continue;
    if(process.env.GITHUB_ACTIONS)console.log('::add-mask::'+job.claim_token);
    let checkpoint={...job.checkpoint};let fenceLost=false;
    const save=async patch=>{
      if(fenceLost)throw new DeliveryError('Delivery lease lost',{ambiguous:true});
      const {error}=await db.rpc('checkpoint_media_delivery',{p_id:job.id,p_token:job.claim_token,p_checkpoint:patch});
      if(error){fenceLost=true;throw new DeliveryError('Checkpoint commit failed',{ambiguous:true});}
      checkpoint={...checkpoint,...patch};
    };
    const heartbeat=setInterval(()=>{save({}).catch(()=>{fenceLost=true;});},60000);heartbeat.unref();
    try {
      const {data:asset,error:assetError}=await db.from('video_delivery_assets').select('job_id,sha256,manifest').eq('video_id',job.video_id).single();
      if(assetError)throw new Error('Verified asset missing');
      const {data:generation,error:generationError}=await db.from('video_generation_jobs').select('render_path').eq('id',asset.job_id).single();
      if(generationError || !generation.render_path)throw new Error('Storage path missing');
      const {data:video,error:videoError}=await db.from('videos').select('article_id,title_bn,description_bn,status,duration_sec').eq('id',job.video_id).single();
      if(videoError || video.status!=='published')throw new DeliveryError('Video not published',{permanent:true});
      if(!Object.keys(checkpoint).length) {
        const {data:article,error:articleError}=await db.from('articles').select('*').eq('id',video.article_id).single();
        if(articleError)throw new Error('Source article recheck failed');
        try{assertEditorial(article,'distribute');}catch{throw new DeliveryError('Article editorial/freshness gate changed; no new provider upload',{permanent:true});}
        await refreshEvidence(article,'distribute');
      }
      const {data:signed,error:signError}=await db.storage.from('reels').createSignedUrl(generation.render_path,21600);
      if(signError)throw new Error('Media signing failed');
      const evidence=asset.manifest.evidence || [],media=asset.manifest.media || [];
      const description=[video.title_bn,'সূত্র:',...evidence.filter(e=>e.role==='news_source'&&e.sha256).map(e=>e.url),'ভিজ্যুয়াল: প্রতীকী ভিডিও; crop/loop/captions/narration added',...media.map(m=>`${m.author} | ${m.license} | ${m.source_url} | ${m.license_url || ''}`)].join('\n');
      const descriptionLimit=target.platform==='instagram'?2200:target.platform==='tiktok'?2200:5000;
      if([...description].length>descriptionLimit)throw new DeliveryError('Required source/license credits exceed caption limit; editor must shorten scene plan, never truncate attribution',{permanent:true});
      const common={accountId:target.account_id,mediaUrl:signed.signedUrl,title:video.title_bn,description,duration:video.duration_sec,checkpoint,save,version:process.env.FACEBOOK_GRAPH_VERSION};
      let result;
      if(checkpoint.verified_result?.id)result=checkpoint.verified_result;
      else if(target.platform==='youtube') {
        const token=await youtubeToken({clientId:await secret(db,'OAUTH_CLIENT_ID'),clientSecret:await secret(db,'OAUTH_CLIENT_SECRET'),refreshToken:await secret(db,'YOUTUBE_REFRESH_TOKEN'),accountId:target.account_id});
        const {data:blob,error:downloadError}=await db.storage.from('reels').download(generation.render_path);
        if(downloadError)throw new Error('Private media download failed');
        const bytes=Buffer.from(await blob.arrayBuffer());
        if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw new DeliveryError('Stored media integrity mismatch',{permanent:true});
        result=await deliverYoutube({...common,token,bytes,privacy:process.env.YOUTUBE_PRIVACY || 'public',synthetic:asset.manifest.synthetic_realistic===true});
      } else if(target.platform==='facebook')result=await deliverFacebook({...common,token:await secret(db,'SOCIAL_FACEBOOK_PAGE_TOKEN',['FACEBOOK_PAGE_ACCESS_TOKEN'])});
      else if(target.platform==='instagram')result=await deliverInstagram({...common,token:await secret(db,'SOCIAL_INSTAGRAM_ACCESS_TOKEN')});
      else if(target.platform==='tiktok') {
        const token=await secret(db,'TIKTOK_ACCESS_TOKEN',['TIKTOK_USER_ACCESS_TOKEN']);
        result=await deliverTiktok({
          token,
          openId:target.account_id,
          mediaUrl:signed.signedUrl,
          title:video.title_bn,
          description,
          duration:video.duration_sec,
          checkpoint,
          save,
          privacy:process.env.TIKTOK_PRIVACY || 'SELF_ONLY'
        });
      } else throw new DeliveryError('Unsupported platform after claim',{permanent:true});
      await save({provider_id:result.id,verified_result:result});
      const {error:finishError}=await db.rpc('finish_media_delivery',{p_id:job.id,p_token:job.claim_token,p_status:'succeeded',p_result:result,p_error:null});
      if(finishError)throw new DeliveryError('Provider succeeded but receipt commit failed',{ambiguous:true});
      console.log(`Verified delivery: ${target.platform} ${result.id}`);
    } catch(error) {
      problems++;
      const status=failureStatus(error,checkpoint);
      const message=error instanceof DeliveryError?error.message:'Local database/storage operation failed; inspect securely';
      const {error:finishError}=await db.rpc('finish_media_delivery',{p_id:job.id,p_token:job.claim_token,p_status:status,p_result:null,p_error:message});
      console.error(`Delivery ${job.id}: ${status}. ${message}${finishError?' Receipt update unavailable; lease recovery will fence this job.':''}`);
    } finally {clearInterval(heartbeat);}
  }
  if(problems)process.exitCode=1;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runDelivery().catch(()=>{console.error('Delivery worker stopped. Check configuration and database contract.');process.exitCode=1;});
