// Facebook Reels accepts 3–90 s. A longer master is delivered ONLY through a human-approved variant registered by
// register-platform-variant.mjs; otherwise deliverFacebook keeps refusing (permanent) exactly as before. Never auto-truncate.
export async function facebookVariant(db,{videoId,masterSha256,masterDuration,signSeconds=21600,bucket='reels'}) {
  if(!(Number(masterDuration)>90))return {};
  const {data,error}=await db.from('video_delivery_variants').select('storage_path,duration_sec,source_sha256').eq('video_id',videoId).eq('platform','facebook').maybeSingle();
  if(error)throw new Error('Facebook variant lookup failed');
  if(!data)return {};
  if(data.source_sha256!==masterSha256)return {};                  // variant was approved for a different render
  const d=Number(data.duration_sec);
  if(!(d>=3&&d<=90))return {};
  const signed=await db.storage.from(bucket).createSignedUrl(data.storage_path,signSeconds);
  if(signed.error||!signed.data?.signedUrl)throw new Error('Facebook variant signing failed');
  return {mediaUrl:signed.data.signedUrl,duration:d};
}
