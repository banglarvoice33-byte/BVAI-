import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../temp_assets');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function inspectRender(manifest) {
  if (![manifest.article_id,manifest.job_id,manifest.claim_token].every(value => UUID.test(value || ''))) throw new Error('Missing/invalid article, job or claim UUID');
  const filename = path.resolve(manifest.video_path || '');
  if (!filename.startsWith(TMP + path.sep) || path.extname(filename) !== '.mp4') throw new Error('Video path must be an MP4 inside temp_assets');
  const size = fs.statSync(filename).size;
  if (size < 1024 || size > 100 * 1024 * 1024) throw new Error('Video size outside 1 KiB–100 MiB bounds');
  const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',filename], { encoding:'utf8',timeout:15000 }));
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  const audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  if (video?.codec_name !== 'h264' || audio?.codec_name !== 'aac' || video.width !== 1080 || video.height !== 1920 || video.pix_fmt !== 'yuv420p') throw new Error('Expected 1080×1920 H.264/yuv420p video with AAC audio');
  if (!Number.isFinite(duration) || duration < 1 || duration > 180) throw new Error('Video duration must be 1–180 seconds');
  if (!Number.isFinite(manifest.audio_duration) || duration + 0.5 < manifest.audio_duration) throw new Error('Render truncates narration');
  if (!['groq-whisper','edge-matched'].includes(manifest.caption_method)) throw new Error('Accurate actual-audio captions required before upload');
  const buffer = fs.readFileSync(filename);
  return { buffer, duration:Math.round(duration), size, hash:createHash('sha256').update(buffer).digest('hex') };
}
export async function upload() {
  const manifestPath = path.join(TMP,'manifest.json');
  if (!fs.existsSync(manifestPath)) { console.log('No pending manifest — nothing to upload.'); return; }
  const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const render = inspectRender(manifest);
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server credentials missing');
  const supabase = createClient(url,key,{ auth:{ persistSession:false,autoRefreshToken:false } });
  const mode = process.env.VIDEO_PUBLISH_MODE || 'website';
  if (!['website','review'].includes(mode)) throw new Error('VIDEO_PUBLISH_MODE must be website or review');
  // Stable job + content path makes retries idempotent, without public bucket access.
  const storagePath = `${manifest.article_id}/${manifest.job_id}-${render.hash.slice(0,32)}.mp4`;
  const bucket = supabase.storage.from('reels');
  const { error: uploadError } = await bucket.upload(storagePath,render.buffer,{ contentType:'video/mp4',upsert:false,cacheControl:'3600' });
  if (uploadError && !['409','Duplicate'].includes(String(uploadError.statusCode || uploadError.error))) throw new Error('Storage upload: ' + uploadError.message);
  // Verify remote bytes before committing a public database row, including on retry.
  const { data:remote,error:downloadError } = await bucket.download(storagePath);
  if (downloadError) throw new Error('Upload verification: ' + downloadError.message);
  const remoteBuffer = Buffer.from(await remote.arrayBuffer());
  if (remoteBuffer.length !== render.size || createHash('sha256').update(remoteBuffer).digest('hex') !== render.hash) throw new Error('Remote upload checksum mismatch');
  const { data:signed,error:signError } = await bucket.createSignedUrl(storagePath,3600);
  if (signError) throw new Error('Playback signing: ' + signError.message);
  const { data:result,error:finalizeError } = await supabase.rpc('finalize_website_video',{
    p_job_id:manifest.job_id,p_article_id:manifest.article_id,p_claim_token:manifest.claim_token,
    p_path:storagePath,p_signed_url:signed.signedUrl,p_duration_sec:render.duration,
    p_sha256:render.hash,p_size_bytes:render.size,p_publish:mode === 'website'
  });
  if (finalizeError) throw new Error('Transactional website publication: ' + finalizeError.message);
  // The frontend refreshes signed links; an expiring URL is not treated as permanent public storage.
  console.log('✅ Website result: ' + JSON.stringify(result));
  const receipt = { article_id:manifest.article_id,job_id:manifest.job_id,result,sha256:render.hash,storage_path:storagePath,completed_at:new Date().toISOString() };
  fs.writeFileSync(path.join(TMP,'receipt.json'),JSON.stringify(receipt,null,2),{ mode:0o600 });
  fs.rmSync(manifestPath,{ force:true });
  fs.rmSync(path.join(TMP,'claim.json'),{ force:true });
  console.log('✅ Social publishing not invoked.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  upload().catch(error => { console.error('❌',error.message); process.exitCode = 1; });
}
