import { measureAudio } from './audio-qc.mjs';
import { deliveryTargets } from './delivery-worker.mjs';
import { uploadResumable } from './storage-upload.mjs';
import { assertEditorial, refreshEvidence } from './source-evidence.mjs';
import { validateVtt } from './voice-captions.js';
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
  if(!fs.realpathSync(filename).startsWith(fs.realpathSync(TMP)+path.sep))throw new Error('Video symlink escapes temp_assets');
  const size = fs.statSync(filename).size;
  if (size < 1024 || size > 100 * 1024 * 1024) throw new Error('Video size outside 1 KiB–100 MiB bounds');
  const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',filename], { encoding:'utf8',timeout:15000 }));
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  const audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  if (video?.codec_name !== 'h264' || audio?.codec_name !== 'aac' || video.width !== 1080 || video.height !== 1920 || video.pix_fmt !== 'yuv420p') throw new Error('Expected 1080×1920 H.264/yuv420p video with AAC audio');
  if (!Number.isFinite(duration) || duration < 40 || duration > 120) throw new Error('Video duration must be 40–120 seconds');
  if (!Number.isFinite(manifest.audio_duration) || duration + 0.5 < manifest.audio_duration) throw new Error('Render truncates narration');
  if (!['groq-whisper','edge-matched'].includes(manifest.caption_method)) throw new Error('Accurate actual-audio captions required before upload');
  const frameRate=video.avg_frame_rate?.split('/').map(Number);
  if(!frameRate || Math.abs(frameRate[0]/frameRate[1]-30)>.01)throw new Error('30 fps master required');
  if(audio.sample_rate!=='48000')throw new Error('48 kHz audio required');
  const captionFile=path.join(path.dirname(filename),'voice.vtt');
  if(!fs.existsSync(captionFile))throw new Error('Actual-audio caption sidecar missing');
  validateVtt(fs.readFileSync(captionFile,'utf8'),manifest.audio_duration);
  // Full decode catches corrupt/truncated streams that metadata-only probing misses.
  execFileSync('ffmpeg',['-v','error','-xerror','-i',filename,'-f','null','-'],{timeout:180000,stdio:'pipe'});
  const loudness=measureAudio(filename);
  if(Math.abs(Number(loudness.input_i)+14)>2 || Number(loudness.input_tp)>-1)throw new Error('Audio outside -14 LUFS ±2 / peak <= -1 dBTP quality gate');
  const buffer = fs.readFileSync(filename);
  return { buffer, duration:Math.ceil(duration), size, hash:createHash('sha256').update(buffer).digest('hex') };
}
export async function upload() {
  const manifestPath = path.join(TMP,'manifest.json');
  if (!fs.existsSync(manifestPath)) { console.log('No pending manifest — nothing to upload.'); return; }
  const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const render = inspectRender(manifest);
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server credentials missing');
  const supabase = createClient(url,key,{ auth:{ persistSession:false,autoRefreshToken:false } });
  const mode = process.env.VIDEO_PUBLISH_MODE || manifest.publish_mode || 'review';
  if (!['website','review','distribute'].includes(mode)) throw new Error('Invalid VIDEO_PUBLISH_MODE');
  const targets=mode==='distribute'?deliveryTargets():[];
  if(mode==='distribute' && !targets.length)throw new Error('Select VIDEO_DELIVERY_PLATFORMS before distribute mode');
  const {data:article,error:articleError}=await supabase.from('articles').select('*').eq('id',manifest.article_id).single();
  if(articleError)throw new Error('Article recheck failed');
  assertEditorial(article,mode);
  if(mode!=='review')manifest.evidence=await refreshEvidence(article,mode);
  // Stable job + content path makes retries idempotent, without public bucket access.
  const storagePath = `${manifest.article_id}/${manifest.job_id}-${render.hash.slice(0,32)}.mp4`;
  const bucket = supabase.storage.from('reels');
  // Preflight existing immutable object; a crash after upload can safely retry.
  const {data:existing,error:existingError}=await bucket.download(storagePath);
  if(existingError) {
    // Supabase reports object-not-found as 400 on some Storage versions.
    if(!/not found|not exist/i.test(existingError.message || '') && !['404'].includes(String(existingError.statusCode)))throw new Error('Storage preflight unavailable');
    await uploadResumable({supabaseUrl:url,key,storagePath,bytes:render.buffer,stateFile:path.join(path.dirname(manifest.video_path),'storage-upload.json')});
  }
  // Verify remote bytes before committing a public database row, including on retry.
  const { data:remote,error:downloadError } = existing?{data:existing,error:null}:await bucket.download(storagePath);
  if (downloadError) throw new Error('Upload verification: ' + downloadError.message);
  const remoteBuffer = Buffer.from(await remote.arrayBuffer());
  if (remoteBuffer.length !== render.size || createHash('sha256').update(remoteBuffer).digest('hex') !== render.hash) throw new Error('Remote upload checksum mismatch');
  const { data:signed,error:signError } = await bucket.createSignedUrl(storagePath,3600);
  if (signError) throw new Error('Playback signing: ' + signError.message);
  const { data:result,error:finalizeError } = await supabase.rpc('finalize_media_delivery',{
    p_job_id:manifest.job_id,p_article_id:manifest.article_id,p_claim_token:manifest.claim_token,
    p_path:storagePath,p_signed_url:signed.signedUrl,p_duration_sec:render.duration,
    p_sha256:render.hash,p_size_bytes:render.size,p_publish:mode !== 'review',p_manifest:manifest,p_targets:targets
  });
  if (finalizeError) throw new Error('Transactional website publication: ' + finalizeError.message);
  // The frontend refreshes signed links; an expiring URL is not treated as permanent public storage.
  console.log('✅ Website result: ' + JSON.stringify(result));
  const receipt = { article_id:manifest.article_id,job_id:manifest.job_id,result,sha256:render.hash,storage_path:storagePath,completed_at:new Date().toISOString() };
  fs.writeFileSync(path.join(TMP,'receipt.json'),JSON.stringify(receipt,null,2),{ mode:0o600 });
  fs.rmSync(manifestPath,{ force:true });
  fs.rmSync(path.join(TMP,'claim.json'),{ force:true });
  console.log(targets.length?'Durable delivery targets queued. Run delivery worker to verify each platform.':'No social targets requested.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  upload().catch(error => { console.error('❌',error.message); process.exitCode = 1; });
}
