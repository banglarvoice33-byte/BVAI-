// Durable provider adapters. save() MUST commit each checkpoint before the next side effect.
export class DeliveryError extends Error {
  constructor(message,{ambiguous=false,permanent=false,safeResume=false}={}) {super(message);this.ambiguous=ambiguous;this.permanent=permanent;this.safeResume=safeResume;}
}
export function providerUrl(raw,hosts) {
  const u=new URL(raw);
  if(u.protocol!=='https:' || u.username || u.password || (u.port&&u.port!=='443') || !hosts.includes(u.hostname))throw new DeliveryError('Unexpected provider upload host',{permanent:true});
  return u.href;
}
async function jsonRequest(url,options={}) {
  let response;
  try {response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(90000)});}
  catch {throw new DeliveryError('Provider request interrupted',{ambiguous:options.method==='POST' || options.method==='PUT'});}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new DeliveryError(`Provider HTTP ${response.status}`,{ambiguous:response.status>=500,permanent:[400,401,403,404].includes(response.status)});
  return data;
}
const auth=t=>({Authorization:`Bearer ${t}`});
function graphVersion(version) {
  const v = version || process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';
  if (!/^v\d+\.\d+$/.test(v)) throw new DeliveryError('Set a verified FACEBOOK_GRAPH_VERSION', { permanent: true });
  return v;
}
export async function youtubeToken({clientId,clientSecret,refreshToken,accountId}) {
  const result=await jsonRequest('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  if(!result.access_token)throw new DeliveryError('OAuth access token missing',{permanent:true});
  const channel=await jsonRequest('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',{headers:auth(result.access_token)});
  if(!channel.items?.some(c=>c.id===accountId))throw new DeliveryError('YouTube account identity mismatch',{permanent:true});
  return result.access_token;
}
export async function deliverYoutube({token,accountId,bytes,title,description,checkpoint={},save,privacy='unlisted',synthetic=false}) {
  if(!['public','unlisted','private'].includes(privacy))throw new DeliveryError('Invalid YouTube privacy',{permanent:true});
  let state={...checkpoint};
  const persist=async patch=>{await save(patch);state={...state,...patch};};
  if(!state.upload_url && !state.provider_id) {
    if(state.phase)throw new DeliveryError('Lost initiation response; reconcile before creating another session',{ambiguous:true});
    await persist({phase:'youtube_initiating'});
    const init=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{
      method:'POST',headers:{...auth(token),'Content-Type':'application/json','X-Upload-Content-Length':String(bytes.length),'X-Upload-Content-Type':'video/mp4'},
      body:JSON.stringify({snippet:{title:[...title].slice(0,100).join(''),description:[...description].slice(0,5000).join(''),categoryId:'25',defaultLanguage:'bn',defaultAudioLanguage:'bn'},status:{privacyStatus:privacy,selfDeclaredMadeForKids:false,containsSyntheticMedia:synthetic}}),redirect:'manual',signal:AbortSignal.timeout(30000)
    }).catch(()=>{throw new DeliveryError('YouTube initiation response lost',{ambiguous:true});});
    if(!init.ok || !init.headers.get('location'))throw new DeliveryError(`YouTube session HTTP ${init.status}`,{ambiguous:true});
    await persist({upload_url:providerUrl(init.headers.get('location'),['www.googleapis.com']),phase:'youtube_uploading'});
  }
  if(!state.provider_id) {
    const uploadUrl=providerUrl(state.upload_url,['www.googleapis.com']);
    const status=await fetch(uploadUrl,{method:'PUT',headers:{...auth(token),'Content-Length':'0','Content-Range':`bytes */${bytes.length}`},redirect:'manual',signal:AbortSignal.timeout(30000)}).catch(()=>{throw new DeliveryError('YouTube session status unknown',{ambiguous:true,safeResume:true});});
    let resource;
    if(status.ok)resource=await status.json();
    else if(status.status===308) {
      const range=status.headers.get('range');const match=range?.match(/^bytes=0-(\d+)$/);
      if(range&&!match)throw new DeliveryError('Invalid provider byte range',{ambiguous:true});
      const offset=match?Number(match[1])+1:0;
      if(offset>=bytes.length)throw new DeliveryError('Session awaiting completion',{ambiguous:true,safeResume:true});
      const upload=await fetch(uploadUrl,{method:'PUT',headers:{...auth(token),'Content-Type':'video/mp4','Content-Length':String(bytes.length-offset),'Content-Range':`bytes ${offset}-${bytes.length-1}/${bytes.length}`},body:bytes.subarray(offset),redirect:'manual',signal:AbortSignal.timeout(480000)}).catch(()=>{throw new DeliveryError('YouTube byte upload outcome unknown; query saved session',{ambiguous:true,safeResume:true});});
      if(!upload.ok)throw new DeliveryError(`YouTube byte upload HTTP ${upload.status}`,{ambiguous:true});
      resource=await upload.json();
    } else throw new DeliveryError(`YouTube session HTTP ${status.status}; never automatically create a replacement`,{ambiguous:true});
    if(!resource?.id)throw new DeliveryError('YouTube completion receipt missing',{ambiguous:true});
    await persist({provider_id:resource.id,phase:'youtube_processing'});
  }
  const verified=await jsonRequest(`https://www.googleapis.com/youtube/v3/videos?part=status,snippet,processingDetails&id=${encodeURIComponent(state.provider_id)}`,{headers:auth(token)});
  const item=verified.items?.[0];
  if(!item || item.snippet?.channelId!==accountId)throw new DeliveryError('YouTube uploaded video identity not verified',{ambiguous:true});
  if(['failed','rejected','deleted'].includes(item.status?.uploadStatus))throw new DeliveryError('YouTube video rejected or failed',{permanent:true});
  if(item.status?.uploadStatus!=='processed')throw new DeliveryError('YouTube processing pending',{ambiguous:true,safeResume:true});
  const actual=item.status?.privacyStatus;
  if(actual!==privacy) {
    // Unaudited API projects are forced to private by YouTube. The upload itself succeeded; record the truth instead of retrying/duplicating.
    if(actual==='private')return {id:state.provider_id,url:`https://youtu.be/${state.provider_id}`,privacy:'private',requested_privacy:privacy,restricted_by_youtube:'API project not audited: videos stay private until the audit is approved',verified_at:new Date().toISOString()};
    throw new DeliveryError('YouTube privacy differs from requested value',{ambiguous:true});
  }
  return {id:state.provider_id,url:`https://youtu.be/${state.provider_id}`,privacy,verified_at:new Date().toISOString()};
}
export async function deliverFacebook({token,accountId,mediaUrl,title,description,duration,version,checkpoint={},save}) {
  if(duration>90)throw new DeliveryError('Verified Facebook Reels API contract is 3–90 seconds; 91–120s master needs a separate approved edit',{permanent:true});
  version = graphVersion(version);
  const graph=`https://graph.facebook.com/${version}`;
  const identity=await jsonRequest(`${graph}/${encodeURIComponent(accountId)}?fields=id`,{headers:auth(token)});
  if(identity.id!==accountId)throw new DeliveryError('Facebook Page identity mismatch',{permanent:true});
  let state={...checkpoint};const persist=async patch=>{await save(patch);state={...state,...patch};};
  const post=(route,body)=>jsonRequest(`${graph}/${route}`,{method:'POST',headers:{...auth(token),'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!state.provider_id) {
    if(state.phase)throw new DeliveryError('Facebook initiation response lost; reconcile first',{ambiguous:true});
    await persist({phase:'facebook_initiating'});
    const result=await post(`${accountId}/video_reels`,{upload_phase:'start'});
    if(!result.video_id || !result.upload_url)throw new DeliveryError('Facebook session receipt missing',{ambiguous:true});
    await persist({provider_id:result.video_id,upload_url:providerUrl(result.upload_url,['rupload.facebook.com']),phase:'facebook_uploading'});
  }
  const read=()=>jsonRequest(`${graph}/${encodeURIComponent(state.provider_id)}?fields=status`,{headers:auth(token)});
  let status=(await read()).status;
  if(status?.publishing_phase?.status==='complete')return {id:state.provider_id,url:`https://www.facebook.com/reel/${state.provider_id}`,verified_at:new Date().toISOString()};
  if(state.phase==='facebook_finishing')throw new DeliveryError('Facebook finish response unknown; reconcile same ID',{ambiguous:true});
  if(state.phase==='facebook_processing')throw new DeliveryError('Facebook processing pending; poll same ID',{safeResume:true});
  if(status?.uploading_phase?.status!=='complete') {
    if(state.phase==='facebook_uploaded')throw new DeliveryError('Facebook upload processing pending',{safeResume:true});
    await persist({phase:'facebook_uploading'});
    await jsonRequest(providerUrl(state.upload_url,['rupload.facebook.com']),{method:'POST',headers:{Authorization:`OAuth ${token}`,file_url:mediaUrl}});
    await persist({phase:'facebook_uploaded'});
    status=(await read()).status;
    if(status?.uploading_phase?.status!=='complete')throw new DeliveryError('Facebook upload pending',{safeResume:true});
  }
  await persist({phase:'facebook_finishing'});
  await post(`${accountId}/video_reels`,{upload_phase:'finish',video_id:state.provider_id,video_state:'PUBLISHED',title:[...title].slice(0,255).join(''),description:[...description].slice(0,5000).join('')});
  await persist({phase:'facebook_processing'});
  status=(await read()).status;
  if(status?.publishing_phase?.status!=='complete')throw new DeliveryError('Facebook publication not confirmed yet',{safeResume:true});
  return {id:state.provider_id,url:`https://www.facebook.com/reel/${state.provider_id}`,verified_at:new Date().toISOString()};
}
export async function deliverInstagram({token,accountId,mediaUrl,description,version,checkpoint={},save}) {
  version = graphVersion(version);
  const graph=`https://graph.facebook.com/${version}`;let state={...checkpoint};
  const persist=async patch=>{await save(patch);state={...state,...patch};};
  const post=(route,body)=>jsonRequest(`${graph}/${route}`,{method:'POST',headers:{...auth(token),'Content-Type':'application/json'},body:JSON.stringify(body)});
  const identity=await jsonRequest(`${graph}/${accountId}?fields=id`,{headers:auth(token)});
  if(identity.id!==accountId)throw new DeliveryError('Instagram account identity mismatch',{permanent:true});
  if(!state.container_id) {
    if(state.phase)throw new DeliveryError('Instagram container receipt lost',{ambiguous:true});
    await persist({phase:'instagram_creating'});
    const created=await post(`${accountId}/media`,{media_type:'REELS',video_url:mediaUrl,caption:[...description].slice(0,2200).join('')});
    if(!created.id)throw new DeliveryError('Instagram container missing',{ambiguous:true});
    await persist({container_id:created.id,phase:'instagram_processing'});
  }
  if(state.provider_id) {
    const media=await jsonRequest(`${graph}/${state.provider_id}?fields=id,permalink`,{headers:auth(token)});
    if(media.id!==state.provider_id)throw new DeliveryError('Instagram receipt not verified',{ambiguous:true});
    return {id:media.id,url:media.permalink,verified_at:new Date().toISOString()};
  }
  const status=await jsonRequest(`${graph}/${state.container_id}?fields=status_code`,{headers:auth(token)});
  if(status.status_code==='PUBLISHED')throw new DeliveryError('Instagram published but media ID unknown; reconcile by account inventory, never republish',{ambiguous:true});
  if(['ERROR','EXPIRED'].includes(status.status_code))throw new DeliveryError('Instagram container failed or expired',{permanent:true});
  if(state.phase==='instagram_publishing')throw new DeliveryError('Instagram publish response unknown',{ambiguous:true});
  if(status.status_code!=='FINISHED')throw new DeliveryError('Instagram container processing pending',{safeResume:true});
  await persist({phase:'instagram_publishing'});
  const result=await post(`${accountId}/media_publish`,{creation_id:state.container_id});
  if(!result.id)throw new DeliveryError('Instagram publish receipt unknown',{ambiguous:true});
  await persist({provider_id:result.id,phase:'instagram_verifying'});
  const verified=await jsonRequest(`${graph}/${result.id}?fields=id,permalink`,{headers:auth(token)});
  if(verified.id!==result.id)throw new DeliveryError('Instagram published ID not yet readable',{safeResume:true});
  return {id:result.id,url:verified.permalink,verified_at:new Date().toISOString()};
}

/**
 * TikTok Content Posting API (Direct Post via PULL_FROM_URL).
 * Domain verification file is under frontend/public/.
 * Until TikTok audits the app, use SELF_ONLY privacy.
 * Never create a second publish init when publish_id already exists in checkpoint.
 */
export async function deliverTiktok({token,openId,mediaUrl,title,description,duration,checkpoint={},save,privacy='SELF_ONLY'}) {
  if(duration<3 || duration>180)throw new DeliveryError('TikTok duration outside supported pilot range',{permanent:true});
  if(!openId || !/^[a-zA-Z0-9_-]+$/.test(openId))throw new DeliveryError('TikTok open_id / account identity missing',{permanent:true});
  const privacyLevel=privacy==='PUBLIC_TO_EVERYONE'?'PUBLIC_TO_EVERYONE':'SELF_ONLY';
  let state={...checkpoint};
  const persist=async patch=>{await save(patch);state={...state,...patch};};
  const headers={...auth(token),'Content-Type':'application/json; charset=UTF-8'};

  if(state.provider_id && state.phase==='tiktok_published') {
    return {id:state.provider_id,url:state.share_url || null,privacy:privacyLevel,verified_at:state.verified_at || new Date().toISOString()};
  }

  if(!state.publish_id) {
    if(state.phase)throw new DeliveryError('TikTok initiation response lost; reconcile before creating another publish',{ambiguous:true});
    await persist({phase:'tiktok_initiating'});
    const initBody={
      post_info:{
        title:[...title].slice(0,150).join(''),
        privacy_level:privacyLevel,
        disable_duet:false,
        disable_comment:false,
        disable_stitch:false,
        video_cover_timestamp_ms:1000
      },
      source_info:{
        source:'PULL_FROM_URL',
        video_url:mediaUrl
      }
    };
    const init=await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/',{
      method:'POST',headers,body:JSON.stringify(initBody),redirect:'manual',signal:AbortSignal.timeout(30000)
    }).catch(()=>{throw new DeliveryError('TikTok init response lost',{ambiguous:true});});
    const data=await init.json().catch(()=>({}));
    if(!init.ok) {
      const code=data?.error?.code || data?.code || '';
      if(String(code).includes('unaudited') || String(code).includes('private'))throw new DeliveryError('TikTok app not audited for public posts; use SELF_ONLY or complete audit',{permanent:true});
      if(String(code).includes('url_ownership') || String(code).includes('unverified'))throw new DeliveryError('TikTok URL ownership unverified; confirm domain verification file is live',{permanent:true});
      throw new DeliveryError(`TikTok init HTTP ${init.status}`,{ambiguous:init.status>=500,permanent:[400,401,403].includes(init.status)});
    }
    const publishId=data?.data?.publish_id;
    if(!publishId)throw new DeliveryError('TikTok publish_id missing from init',{ambiguous:true});
    await persist({publish_id:publishId,phase:'tiktok_processing'});
  }

  const statusResp=await fetch(`https://open.tiktokapis.com/v2/post/publish/status/fetch/`,{
    method:'POST',headers,body:JSON.stringify({publish_id:state.publish_id}),redirect:'manual',signal:AbortSignal.timeout(30000)
  }).catch(()=>{throw new DeliveryError('TikTok status query failed',{ambiguous:true,safeResume:true});});
  const statusData=await statusResp.json().catch(()=>({}));
  if(!statusResp.ok)throw new DeliveryError(`TikTok status HTTP ${statusResp.status}`,{ambiguous:true,safeResume:true});
  const st=statusData?.data?.status;
  const postIds=statusData?.data?.publicaly_available_post_id || statusData?.data?.publicly_available_post_id;
  if(st==='FAILED') {
    throw new DeliveryError('TikTok publish failed: '+(statusData?.data?.fail_reason || st),{permanent:true});
  }
  if(['PROCESSING_UPLOAD','PROCESSING_DOWNLOAD','SENDING_TO_USER_INBOX','PUBLISHING'].includes(st)) {
    throw new DeliveryError('TikTok processing pending; poll same publish_id',{safeResume:true});
  }
  if(st==='PUBLISH_COMPLETE' || postIds) {
    const id=Array.isArray(postIds)?String(postIds[0]):(postIds?String(postIds):state.publish_id);
    const verified_at=new Date().toISOString();
    await persist({provider_id:id,phase:'tiktok_published',verified_at,share_url:null});
    return {id,url:null,privacy:privacyLevel,verified_at,publish_id:state.publish_id};
  }
  throw new DeliveryError('TikTok status unknown; reconcile same publish_id, never re-init',{ambiguous:true,safeResume:true});
}
