import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { splitText, synthesizeVoiceRouted } from '../tts-router.js';
import { timestamp, validateVtt } from '../voice-captions.js';
import { buildVoiceScript } from '../generate-video.js';

const article = { title_bn:'নতুন সেতু চালু হয়েছে',content_bn:'নদীর উপর নতুন সেতু আজ চালু হয়েছে। কর্তৃপক্ষ জানিয়েছে সেতুটি যান চলাচলের জন্য উন্মুক্ত। এই পথে 20টি বাস চলাচল করবে।' };
test('narration uses source facts and complete sentences, not invented impacts or render date',()=>{
  const text = buildVoiceScript(article);
  assert.ok(text.endsWith('ওয়েবসাইটে।')); assert.ok(text.includes('২০টি'));
  assert.ok(!text.includes('আনন্দ ছড়িয়ে'));assert.ok(!text.includes('পরিস্থিতি আরও জটিল'));
  assert.ok(text.length <= 780);
});
test('too-long body is rejected rather than cut mid-sentence',()=>{
  assert.throws(()=>buildVoiceScript({...article,content_bn:'বাক্য '.repeat(300)+'।'}),/complete source/);
});
test('TTS chunks preserve spaces and keep every word within the bound',()=>{
  const original = 'বাংলা সংবাদ বিশ্বের খবর '.repeat(70).trim();
  const chunks = splitText(original);
  assert.ok(chunks.length>1);assert.ok(chunks.every(c=>c.length<=450));
  assert.equal(chunks.join(' '),original);
  assert.throws(()=>splitText('x'.repeat(451)),/token/);
});
test('timestamp milliseconds carry to the next minute',()=>{
  assert.equal(timestamp(59.9996),'00:01:00.000');
  assert.equal(timestamp(3599.9996),'01:00:00.000');
});
test('VTT validator rejects empty, overlapping and out-of-range captions',()=>{
  const good='WEBVTT\n\n00:00:00.100 --> 00:00:00.400\nআজ\n\n00:00:00.400 --> 00:00:00.800\nসংবাদ\n\n';
  assert.equal(validateVtt(good,1),2);
  assert.throws(()=>validateVtt('WEBVTT\n\n',1),/No timed/);
  assert.throws(()=>validateVtt(good.replace('00:00:00.400 -->','00:00:00.200 -->'),1),/overlapping/);
  assert.throws(()=>validateVtt(good,0.3),/timing/);
});
test('Sarvam request uses current v3 fields, decodes and normalizes real bytes offline',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bvai-test-'));
  const savedFetch=globalThis.fetch; const old=process.env.TTS_SARVAM_1;
  try {
    const wav=path.join(folder,'tone.wav');const out=path.join(folder,'voice.mp3');
    execFileSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.6',wav]);
    process.env.TTS_SARVAM_1='offline-test-key';
    globalThis.fetch=async(url,opts)=>{
      assert.equal(url,'https://api.sarvam.ai/text-to-speech');
      const request=JSON.parse(opts.body);
      assert.equal(request.model,'bulbul:v3');assert.equal(request.language_code,'bn-IN');
      assert.equal(request.text,'পরীক্ষার সংবাদ');assert.ok(!('pitch' in request));assert.ok(!('inputs' in request));
      return new Response(JSON.stringify({audios:[fs.readFileSync(wav).toString('base64')]}),{status:200});
    };
    const result=await synthesizeVoiceRouted('পরীক্ষার সংবাদ',{outFile:out});
    assert.equal(result.provider,'sarvam');
    const codec=execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_name','-of','csv=p=0',out],{encoding:'utf8'}).trim();
    assert.equal(codec,'mp3');
  } finally {globalThis.fetch=savedFetch;if(old===undefined)delete process.env.TTS_SARVAM_1;else process.env.TTS_SARVAM_1=old;fs.rmSync(folder,{recursive:true,force:true});}
});
