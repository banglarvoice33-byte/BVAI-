import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {digest} from './review-contract.mjs';
export function localFile(file){if(!fs.statSync(file).isFile())throw Error('Regular local file required');return fs.realpathSync(file);}
export function probe(file){
  const p=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',localFile(file)],{encoding:'utf8',timeout:30000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']}));
  const v=p.streams?.find(s=>s.codec_type==='video');if(!v)throw Error('Video stream missing');
  const duration=Number(p.format.duration);if(!Number.isFinite(duration)||duration<=0||duration>600)throw Error('Duration invalid or exceeds offline QC bound');
  return {duration,width:v.width,height:v.height};
}
export function dHash(pixels){if(pixels.length!==72)throw Error('9x8 gray frame required');let b=0n;for(let y=0;y<8;y++)for(let x=0;x<8;x++)b=(b<<1n)|BigInt(pixels[y*9+x]>pixels[y*9+x+1]);return b.toString(16).padStart(16,'0');}
export function hamming(a,b){if(!/^[a-f0-9]{16}$/.test(a)||!/^[a-f0-9]{16}$/.test(b))throw Error('64-bit fingerprint required');let x=BigInt('0x'+a)^BigInt('0x'+b),n=0;while(x){n+=Number(x&1n);x>>=1n;}return n;}
export function fingerprint(file,{samples=12}={}){
  if(!Number.isInteger(samples)||samples<3||samples>32)throw Error('3–32 samples required');
  const {duration}=probe(file),frames=[];
  for(let i=0;i<samples;i++){
    const bytes=execFileSync('ffmpeg',['-v','error','-nostdin','-ss',String(duration*(i+.5)/samples),'-i',localFile(file),'-frames:v','1','-vf','scale=9:8:flags=area,format=gray','-f','rawvideo','pipe:1'],{timeout:30000,maxBuffer:4096,stdio:['ignore','pipe','pipe']});
    frames.push(dHash(bytes));
  }
  return {algorithm:'gray-dhash64-uniform-v1',duration,frames};
}
export function compareFingerprint(a,b,{threshold=8,ratio=.8}={}){
  if(a.algorithm!=='gray-dhash64-uniform-v1'||a.algorithm!==b.algorithm||a.frames.length!==b.frames.length||a.frames.length<3||![a.duration,b.duration].every(x=>Number.isFinite(x)&&x>0)||!Number.isFinite(threshold)||threshold<0||threshold>64||!Number.isFinite(ratio)||ratio<=0||ratio>1)throw Error('Compatible fingerprints and valid thresholds required');
  const durationRatio=Math.min(a.duration,b.duration)/Math.max(a.duration,b.duration);
  const distances=a.frames.map((f,i)=>hamming(f,b.frames[i]));
  const matched=distances.filter(x=>x<=threshold).length/distances.length;
  return {review_candidate:durationRatio>=.9&&matched>=ratio,matched_fraction:matched,duration_ratio:durationRatio,distances};
}
export function measureLoudness(file){
  const p=spawnSync('ffmpeg',['-hide_banner','-nostdin','-i',localFile(file),'-vn','-af','loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json','-f','null','-'],{encoding:'utf8',timeout:180000,maxBuffer:2097152});
  if(p.status!==0)throw Error('Loudness analysis failed');
  const m=p.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);if(!m)throw Error('Measured loudness missing');
  const j=JSON.parse(m[0]),r={integrated_lufs:Number(j.input_i),true_peak_dbtp:Number(j.input_tp),lra_lu:Number(j.input_lra)};
  if(!Object.values(r).every(Number.isFinite))throw Error('Silence or invalid measured loudness');
  return {...r,passes_project_target:Math.abs(r.integrated_lufs+14)<=1&&r.true_peak_dbtp<=-1.5&&r.lra_lu<=11};
}
export function assertTimedScenes({audio_sha256,caption_audio_sha256,duration,words,scenes}){
  if(!/^[a-f0-9]{64}$/.test(audio_sha256||'')||audio_sha256!==caption_audio_sha256)throw Error('Actual audio binding required');
  if(!Number.isFinite(duration)||duration<=0||!Array.isArray(words)||!words.length||!Array.isArray(scenes)||!scenes.length)throw Error('Matched words and scenes required');
  let previous=0;
  for(const w of words){if(!w.text?.trim()||![w.start,w.end].every(Number.isFinite)||w.start<previous||w.end<=w.start||w.end>duration)throw Error('Invalid actual word timing');previous=w.end;}
  let end=0;
  for(const s of scenes){
    if(!Number.isInteger(s.first_word)||!Number.isInteger(s.last_word)||s.first_word<0||s.last_word<s.first_word||s.last_word>=words.length||s.first_word!==end||s.relevance_reviewed!==true||!s.relevance_note?.trim()||!s.claim_ids?.length||!/^[a-f0-9]{64}$/.test(s.asset_sha256||''))throw Error('Scene coverage or relevance review invalid');
    end=s.last_word+1;
  }
  if(end!==words.length)throw Error('Scene words incomplete');
  return scenes.map(s=>({...s,start:words[s.first_word].start,end:words[s.last_word].end}));
}
export function captionChunks(text,maxGraphemes=24){
  if(typeof text!=='string'||!Number.isInteger(maxGraphemes)||maxGraphemes<1)throw Error('Caption input invalid');
  const segmenter=new Intl.Segmenter('bn',{granularity:'grapheme'}),out=[];let chunk='',count=0;
  for(const {segment} of segmenter.segment(text.normalize('NFC'))){if(count===maxGraphemes){out.push(chunk);chunk='';count=0;}chunk+=segment;count++;}
  if(chunk)out.push(chunk);return out;
}
export const safeRect=(width=1080,height=1920)=>({left:Math.ceil(width*.06),right:Math.floor(width*.94),top:Math.ceil(height*.14),bottom:Math.floor(height*.65)});
export function assertCaptionBox(box,width=1080,height=1920){const r=safeRect(width,height);if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0||box.x<r.left||box.y<r.top||box.x+box.width>r.right||box.y+box.height>r.bottom)throw Error('Caption outside conservative project safe zone');return true;}
// Fingerprints are heuristic review candidates, NOT semantic dedup or global reservations.
