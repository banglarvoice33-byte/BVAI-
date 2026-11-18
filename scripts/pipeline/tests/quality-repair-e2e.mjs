// Actual FFmpeg repair of a deliberately invalid synthetic master. NO paid API calls.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {inspectRender} from '../upload-supabase-video.mjs';
import {inspectWithRepair} from '../enhanced/quality-repair.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const dir=path.join(root,'temp_assets',randomUUID());
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const video=path.join(dir,'final_output.mp4');
try{
 execFileSync('ffmpeg',['-nostdin','-y','-v','error','-f','lavfi','-i','color=c=blue:s=720x1280:r=24:d=41','-f','lavfi','-i','sine=frequency=440:duration=40','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-ar','44100','-ac','1','-af','volume=0.05','-t','41',video],{timeout:180000,stdio:'pipe'});
 fs.writeFileSync(path.join(dir,'voice.vtt'),'WEBVTT\n\n00:00:00.100 --> 00:00:01.000\nপরীক্ষার শব্দ\n\n');
 const manifest={article_id:randomUUID(),job_id:randomUUID(),claim_token:randomUUID(),video_path:video,audio_duration:40,caption_method:'groq-whisper'};
 assert.throws(()=>inspectRender(manifest),/Invalid delivery master/);
 const result=await inspectWithRepair(manifest,{inspect:inspectRender});
 assert.equal(result.history[0].action,'reencode_master');
 assert.ok(result.result.size>1024);
 assert.ok(Math.abs(Number(result.result.loudness.input_i)+14)<=2);
 assert.ok(Number(result.result.loudness.input_tp)<=-1);
 console.log(JSON.stringify({pass:true,scope:'synthetic FFmpeg fixture, not real Bengali speech',repaired_from:'720x1280/24fps/44.1kHz/mono',repaired_to:'1080x1920/30fps/48kHz/stereo/H264/BT709',attempts:result.history.length+1,duration:result.result.duration,integrated_lufs:result.result.loudness.input_i,true_peak_dbtp:result.result.loudness.input_tp},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
