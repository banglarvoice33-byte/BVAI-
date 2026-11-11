// Offline integration check: synthetic tone/color only; no TTS, news or provider API calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { composeVideo, renderOverlay } from '../generate-video.js';
import { inspectRender } from '../upload-supabase-video.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const tmp=path.join(root,'temp_assets');
if(fs.existsSync(path.join(tmp,'manifest.json')) || fs.existsSync(path.join(tmp,'claim.json'))) throw new Error('Refusing smoke test over a live render');
fs.mkdirSync(tmp,{recursive:true});
const audio=path.join(tmp,'smoke.mp3');const clip=path.join(tmp,'smoke-clip.webm');
const sub=path.join(tmp,'voice.vtt');const overlay=path.join(tmp,'smoke-overlay.png');const out=path.join(tmp,'smoke-output.mp4');
try {
  execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=40','-c:a','libmp3lame',audio]);
  execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=0x162236:s=320x568:r=30:d=1','-c:v','libvpx-vp9','-threads','1','-pix_fmt','yuv420p',clip]);
  fs.writeFileSync(sub,'WEBVTT\n\n00:00:00.100 --> 00:00:00.800\nপরীক্ষার\n\n00:00:00.900 --> 00:00:01.800\nসংবাদ\n\n');
  renderOverlay('বাংলার ভয়েস — রেন্ডার পরীক্ষা',overlay);
  const result=composeVideo([clip,clip,clip],audio,sub,overlay,out);
  const metadata=inspectRender({article_id:'00000000-0000-0000-0000-000000000001',job_id:'00000000-0000-0000-0000-000000000002',claim_token:'00000000-0000-0000-0000-000000000003',video_path:out,audio_duration:result.audioDur,caption_method:'groq-whisper'});
  assert.ok(metadata.duration>=40 && metadata.duration<=120);
  const png=process.env.SMOKE_PREVIEW_PATH;
  if(png)execFileSync('ffmpeg',['-y','-v','error','-ss','1.0','-i',out,'-frames:v','1',png]);
  console.log('PASS offline FFmpeg 1080x1920 H.264/AAC render; ASS captions burned; full decode and checksum gate passed');
} finally {
  for(const filename of ['smoke.mp3','smoke-clip.webm','voice.vtt','voice.ass','smoke-overlay.png','smoke-output.mp4','smoke-overlay.svg','credit.txt']) fs.rmSync(path.join(tmp,filename),{force:true});
}
