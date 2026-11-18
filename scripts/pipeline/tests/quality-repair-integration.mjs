// Actual local FFmpeg repair integration, synthetic fixtures only. No AI/service requests.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {MASTER_COLOR_ARGS} from '../video-contract.mjs';
import {inspectRender} from '../upload-supabase-video.mjs';
import {inspectWithRepair} from '../enhanced/quality-repair.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const job=randomUUID(),dir=path.join(root,'temp_assets',job);fs.mkdirSync(dir,{recursive:true});
const manifest={article_id:randomUUID(),job_id:job,claim_token:randomUUID(),video_path:path.join(dir,'final_output.mp4'),audio_duration:41,caption_method:'groq-whisper'};
try{
 execFileSync('ffmpeg',['-nostdin','-y','-v','error','-f','lavfi','-i','testsrc2=size=1080x1920:rate=30','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','42','-vf','setsar=1','-c:v','libx264','-preset','ultrafast','-crf','35',...MASTER_COLOR_ARGS,'-af','volume=0.01','-c:a','aac','-ar','48000','-ac','2',manifest.video_path],{timeout:180000,stdio:'pipe'});
 fs.writeFileSync(path.join(dir,'voice.vtt'),'WEBVTT\n\n00:00:00.100 --> 00:00:40.900\nশুধু পরীক্ষার কৃত্রিম অডিও\n\n');
 assert.throws(()=>inspectRender(manifest),/Audio outside/);
 const {result,history}=await inspectWithRepair(manifest,{inspect:inspectRender});
 assert.equal(history.length,1);assert.equal(history[0].action,'normalize_audio');
 assert.ok(Number(result.loudness.input_i)>=-16&&Number(result.loudness.input_i)<=-12);
 console.log(JSON.stringify({test:'real_ffmpeg_audio_repair',passed:true,repairs:history.length,measured_lufs:Number(result.loudness.input_i),measured_peak_dbtp:Number(result.loudness.input_tp),scope:'synthetic tone; no perceptual or language-quality certification'}));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
