import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fingerprint,compareFingerprint,measureLoudness,probe} from './media-qc.mjs';
test('real FFmpeg transcode fingerprint and final-file loudness measurement',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bvai-quality-'));
 try{
 const a=path.join(dir,'a.mp4'),b=path.join(dir,'b.mp4');
 execFileSync('ffmpeg',['-v','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=320x568:rate=12:duration=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',a],{timeout:60000});
 execFileSync('ffmpeg',['-v','error','-nostdin','-y','-i',a,'-vf','scale=240:426','-c:v','libx264','-crf','28','-preset','ultrafast','-c:a','aac',b],{timeout:60000});
 assert.equal(probe(a).width,320);
 const fa=fingerprint(a,{samples:4}),fb=fingerprint(b,{samples:4});
 assert.equal(compareFingerprint(fa,fb).review_candidate,true);
 const measured=measureLoudness(a);assert.ok(Number.isFinite(measured.integrated_lufs));assert.equal(measured.passes_project_target,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
