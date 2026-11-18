import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {numberToBangla,normalizeBanglaForTts} from '../bangla-normalize.mjs';
import {assertEditorial,nearDuplicate,publicAddress,sourceUrls} from '../source-evidence.mjs';
import {deliveryTargets,failureStatus} from '../delivery-worker.mjs';
import {deliverYoutube,deliverFacebook,deliverInstagram,DeliveryError,providerUrl} from '../delivery-providers.mjs';
import {uploadResumable} from '../storage-upload.mjs';
const verified={status:'published',human_verified:true,verification_status:'verified',source_published_at:new Date().toISOString(),content_bn:'বাংলা সংবাদে তথ্য যাচাই করা জরুরি। এটি একটি পরীক্ষার সংবাদ এবং সব দাবি যাচাই করার দায়িত্ব সম্পাদকের।',source_url:'https://a.example/news',fact_sources:[{url:'https://b.example/statement'}]};
test('Bangla complete irregular 0–99 table and safe large grouping',()=>{
  const words=Array.from({length:100},(_,n)=>numberToBangla(n));assert.equal(new Set(words).size,100);
  for(const [n,w] of [[31,'একত্রিশ'],[42,'বিয়াল্লিশ'],[57,'সাতান্ন'],[99,'নিরানব্বই'],[120000,'এক লাখ বিশ হাজার'],[10000000,'এক কোটি']])assert.equal(numberToBangla(n),w);
  assert.throws(()=>numberToBangla(Number.MAX_SAFE_INTEGER+1));
});
test('Normalizer handles decimal percent mixed digits money phone and valid date',()=>{
  const out=normalizeBanglaForTts('৳১,২০,০০০ ও $500। ১২.৫%। ২১/০২/২০২৪। ০১৭১২-৩৪৫৬৭৮');
  assert.match(out,/টাকা এক লাখ বিশ হাজার/);assert.match(out,/ডলার পাঁচশ/);assert.match(out,/বারো দশমিক পাঁচ শতাংশ/);assert.match(out,/একুশে ফেব্রুয়ারি দুই হাজার চব্বিশ/);assert.match(out,/শূন্য এক সাত এক দুই তিন চার পাঁচ ছয় সাত আট/);assert.doesNotMatch(out,/[০-৯0-9]/);
});
test('Normalizer preserves numeric punctuation and expands ordinals / ISO dates',()=>{
  assert.equal(normalizeBanglaForTts('২৪, তবে ২১শে ফেব্রুয়ারি।'), 'চব্বিশ, তবে একুশে ফেব্রুয়ারি।');
  assert.equal(normalizeBanglaForTts('২০২৪-০২-২১'), 'একুশে ফেব্রুয়ারি দুই হাজার চব্বিশ');
});
test('Normalizer rejects invalid dates grouping empty text and preserves display-language conjuncts',()=>{
  assert.throws(()=>normalizeBanglaForTts('৩১/০২/২০২৪'),/date/);assert.throws(()=>normalizeBanglaForTts('৳1,2,34'),/grouping/);assert.throws(()=>normalizeBanglaForTts(''));
  assert.equal(normalizeBanglaForTts('বিদ্যালয় ও শিক্ষক'), 'বিদ্যালয় ও শিক্ষক');
});
test('Editorial gate blocks unverified or English content; approved reporter work has no external source quota',()=>{
  assert.doesNotThrow(()=>assertEditorial(verified,'distribute'));
  assert.throws(()=>assertEditorial({...verified,human_verified:false},'website'),/Human/);
  assert.throws(()=>assertEditorial({...verified,content_bn:'English content only'},'review'),/Bengali/);
  assert.doesNotThrow(()=>assertEditorial({...verified,fact_sources:[]},'distribute'));
  assert.doesNotThrow(()=>assertEditorial({...verified,source_published_at:'2020-01-01'},'website'));
  assert.doesNotThrow(()=>assertEditorial({...verified,human_verified:false},'review'));
  assert.equal(sourceUrls(verified).length,2);
});
test('Near duplicate token overlap catches obvious recycle without claiming semantic proof',()=>{
  const text='এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চৌদ্দ পনেরো ষোলো সতেরো আঠারো উনিশ বিশ';
  assert.equal(nearDuplicate(text,text+' এক'),true);assert.equal(nearDuplicate(text,'ভিন্ন খবর।'),false);
});
test('Reject private and mapped IPv4/IPv6 source destinations',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(publicAddress(ip),false);
  assert.equal(publicAddress('1.1.1.1'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
  assert.throws(()=>providerUrl('https://evil.test/upload',['www.googleapis.com']));
});
test('Targets disabled by default, explicit account required and unsupported platforms rejected',()=>{
  assert.deepEqual(deliveryTargets({}),[]);
  assert.throws(()=>deliveryTargets({VIDEO_DELIVERY_PLATFORMS:'x'}),/Unsupported/);
  assert.throws(()=>deliveryTargets({VIDEO_DELIVERY_PLATFORMS:'youtube'}),/YOUTUBE_CHANNEL/);
  assert.equal(deliveryTargets({VIDEO_DELIVERY_PLATFORMS:'youtube,youtube',YOUTUBE_CHANNEL_ID:'UCabc'}).length,1);
});
test('Ambiguous side effects go to reconciliation, never automatic fresh upload',()=>{
  assert.equal(failureStatus(new DeliveryError('timeout',{ambiguous:true}),{}),'needs_reconciliation');
  assert.equal(failureStatus(new Error('network'),{upload_url:'saved'}),'needs_reconciliation');
  assert.equal(failureStatus(new Error('storage'),{}),'retrying');
  assert.equal(failureStatus(new DeliveryError('processing',{safeResume:true}),{provider_id:'same'}),'retrying');
});
const response=(data,status=200,headers={})=>new Response(data===null?null:JSON.stringify(data),{status,headers});
async function mocked(fn,body){const old=globalThis.fetch;try{globalThis.fetch=fn;return await body();}finally{globalThis.fetch=old;}}
const processed={items:[{snippet:{channelId:'UCtest'},status:{uploadStatus:'processed',privacyStatus:'unlisted'}}]};
test('YouTube persists session BEFORE bytes, verifies processing and account',async()=>{
  let saved={};let uploads=0;const bytes=Buffer.from('test');
  await mocked(async(url,opts)=>{
    if(String(url).includes('uploadType=resumable'))return response(null,200,{location:'https://www.googleapis.com/upload/session'});
    if(String(url).includes('/upload/session')){
      assert.ok(saved.upload_url);
      if(opts.headers['Content-Range']==='bytes */4')return response(null,308);
      uploads++;return response({id:'yt-id'},201);
    }
    return response(processed);
  },async()=>{const result=await deliverYoutube({token:'test',accountId:'UCtest',bytes,title:'সংবাদ',description:'সূত্র',save:async p=>{saved={...saved,...p};}});assert.equal(result.id,'yt-id');});
  assert.equal(uploads,1);assert.equal(saved.provider_id,'yt-id');
});
test('YouTube resume after lost response reuses completed session without creating or uploading again',async()=>{
  const calls=[];
  await mocked(async(url,opts)=>{calls.push(String(url));if(String(url).includes('/session'))return response({id:'existing'},201);return response(processed);},async()=>{
    const result=await deliverYoutube({token:'x',accountId:'UCtest',bytes:Buffer.from('test'),title:'x',description:'x',checkpoint:{upload_url:'https://www.googleapis.com/session'},save:async()=>{}});assert.equal(result.id,'existing');
  });assert.equal(calls.length,2);assert.ok(!calls.some(u=>u.includes('uploadType')));
});
test('YouTube uncertain initiation never silently opens another session',async()=>{
  await assert.rejects(()=>deliverYoutube({checkpoint:{phase:'youtube_initiating'},bytes:Buffer.from('x'),save:async()=>{}}),/reconcile/);
});
test('YouTube partial resume starts at acknowledged byte offset',async()=>{
  await mocked(async(url,opts)=>{
    if(String(url).includes('/session')) {
      if(opts.headers['Content-Range']==='bytes */4')return response(null,308,{Range:'bytes=0-1'});
      assert.equal(opts.headers['Content-Range'],'bytes 2-3/4');assert.equal(opts.body.toString(),'st');return response({id:'partial'},201);
    }return response(processed);
  },async()=>{assert.equal((await deliverYoutube({token:'t',accountId:'UCtest',bytes:Buffer.from('test'),title:'t',description:'d',checkpoint:{upload_url:'https://www.googleapis.com/session'},save:async()=>{}})).id,'partial');});
});
test('Facebook API duration gate blocks 120s before any request',async()=>{
  await mocked(()=>{throw new Error('should not fetch');},async()=>{await assert.rejects(()=>deliverFacebook({duration:120}),/90 seconds/);});
});
test('Facebook confirmed ID is reconciled without issuing another finish',async()=>{
  const calls=[];
  await mocked(async(url,opts)=>{calls.push(opts.method || 'GET');return String(url).includes('fields=id')?response({id:'123'}):response({status:{publishing_phase:{status:'complete'}}});},async()=>{
    const result=await deliverFacebook({token:'x',accountId:'123',duration:60,version:'v27.0',checkpoint:{provider_id:'456',phase:'facebook_processing'},save:async()=>{}});assert.equal(result.id,'456');
  });assert.deepEqual(calls,['GET','GET']);
});
test('Instagram PUBLISHED container with missing receipt never gets republished',async()=>{
  let posts=0;
  await mocked(async(url,opts)=>{if(opts.method==='POST')posts++;return String(url).includes('fields=id')?response({id:'123'}):response({status_code:'PUBLISHED'});},async()=>{
    await assert.rejects(()=>deliverInstagram({token:'x',accountId:'123',version:'v27.0',checkpoint:{container_id:'c',phase:'instagram_publishing'},save:async()=>{}}),/never republish/);
  });assert.equal(posts,0);
});
test('TUS persists session and resumes same URL using acknowledged offsets',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bvai-tus-'));const stateFile=path.join(dir,'state.json');let offset=0;let created=0;
  try {await mocked(async(url,opts)=>{
    if(opts.method==='POST'){created++;return response(null,201,{location:'/storage/v1/upload/resumable/id'});}
    if(opts.method==='HEAD')return response(null,200,{'Upload-Offset':String(offset)});
    assert.ok(fs.existsSync(stateFile));offset+=opts.body.length;return response(null,204,{'Upload-Offset':String(offset)});
  },async()=>{
    const input={supabaseUrl:'https://project.supabase.co',key:'offline',storagePath:'a/test.mp4',bytes:Buffer.from('test'),stateFile};await uploadResumable(input);await uploadResumable(input);
  });assert.equal(created,1);assert.equal(offset,4);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Provider processing polls are safely retryable using the same checkpoint',()=>{
  assert.equal(failureStatus(new DeliveryError('processing',{safeResume:true}),{provider_id:'same-id'}),'retrying');
});
test('Recovery archive encrypts/authenticates roundtrip and rejects tampering',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bvai-recovery-'));
  try {
    fs.mkdirSync(path.join(root,'scripts/pipeline'),{recursive:true});fs.mkdirSync(path.join(root,'temp_assets'));
    const script=path.join(root,'scripts/pipeline/protect-recovery.mjs');
    fs.copyFileSync(new URL('../protect-recovery.mjs',import.meta.url),script);
    fs.writeFileSync(path.join(root,'temp_assets/claim.json'),'offline-sensitive-fixture');
    const env={...process.env,VIDEO_RECOVERY_KEY:randomBytes(32).toString('base64')};
    execFileSync(process.execPath,[script],{env});
    const encrypted=path.join(root,'recovery.bvai.enc'),plain=path.join(root,'recovered.tar.gz');
    assert.equal(fs.readFileSync(encrypted).includes(Buffer.from('offline-sensitive-fixture')),false);
    execFileSync(process.execPath,[script,'--decrypt',encrypted,plain],{env});
    assert.match(execFileSync('tar',['-tzf',plain],{encoding:'utf8'}),/claim.json/);
    const tampered=fs.readFileSync(encrypted);tampered[tampered.length-1]^=1;fs.writeFileSync(encrypted,tampered);
    const bad=path.join(root,'bad.tar.gz');
    assert.throws(()=>execFileSync(process.execPath,[script,'--decrypt',encrypted,bad],{env,stdio:'pipe'}));assert.equal(fs.existsSync(bad),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
