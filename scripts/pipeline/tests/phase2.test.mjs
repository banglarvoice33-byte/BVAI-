// Phase-2 offline tests. Needs ffmpeg/ffprobe (skipped when absent) and python3 (real vtt-to-karaoke.py output).
// Optional PostgreSQL parity checks: PHASE2_PSQL="psql -h /socket -p 54329 -U postgres -d bvai_real" (skipped when unset).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dhash,hamming,overlap,isPerceptualDuplicate,extractFrameHashes,reservePerceptual,isFlat,guardVideoClip} from '../perceptual-video.mjs';
import {facebookVariant} from '../facebook-variant.mjs';
import {checkCaptions,assertCaptionSafe,graphemes,captionGuard} from '../caption-qc.mjs';
import {claimKey,normalizeClaim,parseEvidenceLines} from '../review-claims.mjs';
import {createReviewApp} from '../review-server.mjs';
import {exitCodeFor,dedupe,render,run,alertId} from '../metrics-report.mjs';
import {probeVariant,registerVariant} from '../register-platform-variant.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const PIPE=path.join(HERE,'..');
const have=bin=>spawnSync(bin,['-version'],{stdio:'ignore'}).status===0;
const FFMPEG=have('ffmpeg')&&have('ffprobe');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bvai-p2-'));
const ff=(...a)=>execFileSync('ffmpeg',['-v','error','-y',...a],{stdio:'pipe',timeout:120000});
const psql=process.env.PHASE2_PSQL;
const sql=q=>execFileSync('sh',['-c',`${psql} -X -Atq -c "$Q"`],{env:{...process.env,Q:q},encoding:'utf8'}).trim();

// ---------- perceptual video ----------
test('dhash/hamming basics and flat-frame exclusion',()=>{
  const gradient=Uint8Array.from({length:72},(_,i)=>(i%9)*20);          // each row decreasing? increasing -> no ">" bits
  const inverse=Uint8Array.from({length:72},(_,i)=>(8-(i%9))*20);       // every comparison true -> all ones
  assert.equal(dhash(gradient),'0000000000000000');
  assert.equal(dhash(inverse),'ffffffffffffffff');
  assert.ok(isFlat(dhash(gradient)));
  assert.equal(hamming('0000000000000000','000000000000000f'),4);
  assert.equal(hamming('ffffffffffffffff','0000000000000000'),64);
  assert.throws(()=>dhash(new Uint8Array(10)));
  assert.equal(overlap(['0000000000000000','ffffffffffffffff'],['0123456789abcdef']),0,'flat frames never match');
});
test('frame-hash strings stay lossless 64-bit hex (no JS number truncation)',()=>{
  const g=Uint8Array.from({length:72},(_,i)=>(i*37)%251);
  const h=dhash(g);assert.match(h,/^[0-9a-f]{16}$/);
  assert.equal(BigInt('0x'+h).toString(16).padStart(16,'0'),h);
});
test('reservePerceptual maps database errors without leaking details',async()=>{
  const db=m=>({rpc:async()=>({error:{message:m}})});
  await assert.rejects(reservePerceptual(db('perceptual_duplicate'),{jobId:'j',claimToken:'t',sha256:'a',sourceUrl:'u',frames:[]}),/near-duplicate/);
  await assert.rejects(reservePerceptual(db('boom secret=abc'),{jobId:'j',claimToken:'t',sha256:'a',sourceUrl:'u',frames:[]}),/Perceptual reservation failed/);
  assert.equal(await reservePerceptual({rpc:async()=>({error:null})},{jobId:'j',claimToken:'t',sha256:'a',sourceUrl:'u',frames:[]}),true);
});
test('synthetic clips: re-encode, rescale and trim are caught; unrelated is not; transforms measured',{skip:!FFMPEG},()=>{
  const base=path.join(tmp,'base.mp4');
  ff('-f','lavfi','-i','testsrc2=size=640x360:rate=10:duration=10','-pix_fmt','yuv420p','-c:v','libx264','-crf','18',base);
  const variants={
    reencode_small:['-i',base,'-vf','scale=320:180','-c:v','libx264','-crf','35'],
    trimmed:['-ss','2','-t','5','-i',base,'-c:v','libx264','-crf','30'],
    flipped:['-i',base,'-vf','hflip','-c:v','libx264','-crf','23'],
    boxed_overlay:['-i',base,'-vf','drawbox=x=20:y=20:w=140:h=60:color=white@1:t=fill','-c:v','libx264','-crf','23'],
    heavy_crop:['-i',base,'-vf','crop=iw/2:ih/2:0:0,scale=640:360','-c:v','libx264','-crf','23'],
  };
  const other=path.join(tmp,'other.mp4');
  ff('-f','lavfi','-i','mandelbrot=size=640x360:rate=10','-t','10','-pix_fmt','yuv420p','-c:v','libx264',other);
  const A=extractFrameHashes(base);assert.ok(A.length>=15);
  const measured={};
  for(const [name,args] of Object.entries(variants)){
    const out=path.join(tmp,name+'.mp4');ff(...args,'-pix_fmt','yuv420p',out);
    const B=extractFrameHashes(out);
    measured[name]={overlap:Math.max(overlap(A,B),overlap(B,A)),duplicate:isPerceptualDuplicate(A,B)};
  }
  const O=extractFrameHashes(other);
  measured.unrelated_mandelbrot={overlap:Math.max(overlap(A,O),overlap(O,A)),duplicate:isPerceptualDuplicate(A,O)};
  console.log('perceptual measurements (threshold: Hamming<=10, overlap>=0.6):\n'+JSON.stringify(measured,null,1));
  assert.equal(measured.reencode_small.duplicate,true,'re-encode+rescale must be caught');
  assert.equal(measured.trimmed.duplicate,true,'trimmed re-encode must be caught');
  assert.equal(measured.unrelated_mandelbrot.duplicate,false,'unrelated clip must not be flagged');
});
test('extractFrameHashes refuses unreadable/too-short input',{skip:!FFMPEG},()=>{
  assert.throws(()=>extractFrameHashes(path.join(tmp,'does-not-exist.mp4')),/extraction failed|Too few/);
});

// ---------- caption QC on REAL vtt-to-karaoke.py output ----------
const bnVtt=`WEBVTT

00:00:00.000 --> 00:00:02.400
প্রধানমন্ত্রী আজ রাষ্ট্রীয় সফরে ঢাকা ত্যাগ করেছেন

00:00:02.400 --> 00:00:05.200
বিশ্ববিদ্যালয়ের শিক্ষার্থীরা সংসদ ভবনের সামনে সমাবেশ করেন

00:00:05.200 --> 00:00:08.000
দুর্ঘটনায় আহত ব্যক্তিদের হাসপাতালে ভর্তি করা হয়েছে
`;
function realAss(vtt){
  const v=path.join(tmp,'t.vtt'),a=path.join(tmp,'t.ass');fs.writeFileSync(v,vtt);
  execFileSync(process.env.PYTHON||'python3',[path.join(PIPE,'vtt-to-karaoke.py'),v,a,'Noto Sans Bengali'],{stdio:'pipe'});
  return fs.readFileSync(a,'utf8');
}
test('caption QC accepts the pipeline\'s real karaoke ASS (Bengali conjuncts) — report problems if not',()=>{
  const ass=realAss(bnVtt);
  const problems=checkCaptions(ass);
  console.log('caption QC on real ASS:',problems.length?problems:'no problems');
  assert.deepEqual(problems,[],'QC would block real renders: '+problems.join('; '));
});
test('caption QC rejects split conjuncts, split graphemes, long lines, unsafe geometry',()=>{
  const ass=realAss(bnVtt);
  assert.match(ass,/\[Events\]/);
  const bad=(from,to)=>ass.replace(from,to);
  assert.ok(checkCaptions(ass.replace(/Dialogue: ([^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,)(.*)$/m,(m,p)=>`Dialogue: ${p}ক্ খবর`)).some(p=>/hasanta/.test(p)));
  assert.ok(checkCaptions(ass.replace(/Dialogue: ([^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,)(.*)$/m,(m,p)=>`Dialogue: ${p}ি খবর`)).some(p=>/combining mark/.test(p)));
  assert.ok(checkCaptions(ass.replace(/Dialogue: ([^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,)(.*)$/m,(m,p)=>`Dialogue: ${p}${'ক'.repeat(40)}`)).some(p=>/longer than 30/.test(p)));
  const styleLine=ass.split('\n').find(l=>l.startsWith('Style: Karaoke'));
  assert.ok(styleLine,'Karaoke style present');
  const f=styleLine.split(',');f[21]='20';   // MarginV into the bottom UI zone
  assert.ok(checkCaptions(ass.replace(styleLine,f.join(','))).some(p=>/bottom 35%/.test(p)));
  assert.throws(()=>assertCaptionSafe(ass.replace(styleLine,f.join(','))),/Caption QC failed/);
  assert.throws(()=>assertCaptionSafe('[Script Info]\n'),/no caption events|unreadable|Caption QC/);
});
test('grapheme counting treats a Bengali conjunct as one unit',()=>{
  assert.equal(graphemes('ক্ষ').length,1);
  assert.ok(graphemes('বিশ্ববিদ্যালয়').length<'বিশ্ববিদ্যালয়'.length);
});

// ---------- claim identity parity with PostgreSQL ----------
test('claimKey is whitespace/NFC-stable',()=>{
  assert.equal(claimKey('বাজেট  এক\nলাখ টাকা।'),claimKey('বাজেট এক লাখ টাকা।'));
  assert.equal(claimKey('ক়'),claimKey('ক়'.normalize('NFC')));
  assert.equal(normalizeClaim('  a   b '),'a b');
});
test('claimKey equals SQL media_claim_key for Bengali, whitespace and NFD input',{skip:!psql},()=>{
  for(const s of ['মন্ত্রী আজ ঘোষণা দিয়েছেন।','বাজেট   এক লাখ\nটাকা।','ড়'+'়','Plain ASCII text.','দ্য']){
    assert.equal(sql(`select public.media_claim_key(convert_from(decode('${Buffer.from(s,'utf8').toString('hex')}','hex'),'UTF8'))`),claimKey(s),JSON.stringify(s));
  }
});
test('evidence line parser: https only, role whitelist, independence only when stated',()=>{
  assert.deepEqual(parseEvidenceLines('https://a.example/x | primary_document | independent\nhttps://b.example'),[{url:'https://a.example/x',role:'primary_document',independent_confirmed:true},{url:'https://b.example',role:'news_source'}]);
  assert.throws(()=>parseEvidenceLines('http://a.example'),/https/);
  assert.throws(()=>parseEvidenceLines('https://a.example | blog'),/role/);
  assert.deepEqual(parseEvidenceLines(''),[]);
});

// ---------- review server ----------
function fakeDb(){
  const calls=[];
  const rows={video_generation_jobs:[{id:'11111111-1111-4111-8111-111111111111',article_id:'22222222-2222-4222-8222-222222222222',status:'needs_review',render_path:'a/b.mp4',created_at:'2026-11-21'}],
    articles:[{title_bn:'শিরোনাম <script>alert(1)</script>',source_name:'S"rc',source_url:'https://x.example/?a=1&b=2'}],video_claim_reviews:[],video_review_checks:[]};
  const q=t=>{const b={filters:[],select(){return b;},eq(){return b;},in(){return b;},not(){return b;},order(){return b;},limit(){return b;},
    maybeSingle:async()=>({data:rows[t]?.[0]||null,error:null}),single:async()=>({data:rows[t]?.[0]||null,error:null}),then:(res)=>res({data:rows[t]||[],error:null})};return b;};
  return {calls,from:q,storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://s.example/signed.mp4?token=abc'}})})},
    rpc:async(name,args)=>{calls.push({name,args});
      if(name==='media_review_claims')return {data:[{ord:1,claim_key:'0123456789abcdef',claim_text:'দাবি <img src=x onerror=alert(1)>'}],error:null};
      if(name==='media_review_gate')return {data:{ok:false,claims:1,video_sha256:'d'.repeat(64),blockers:[{code:'claim_not_reviewed',claim_key:'0123456789abcdef'}]},error:null};
      return {data:true,error:null};}};
}
async function withServer(fn){
  const db=fakeDb(),token='t'.repeat(32);
  let port;for(let i=0;i<20;i++){port=30000+Math.floor(Math.random()*20000);
    const s=http.createServer(createReviewApp({db,token,reviewer:'Operator A',port}));
    try{await new Promise((r,j)=>{s.once('error',j);s.listen(port,'127.0.0.1',r);});
      try{return await fn({db,token,port,base:`http://127.0.0.1:${port}`});}finally{await new Promise(r=>s.close(r));}}catch(e){if(e.code!=='EADDRINUSE')throw e;}}
  throw new Error('no free port');
}
const req=(base,p,{method='GET',headers={},body}={})=>fetch(base+p,{method,headers,body,redirect:'manual'});
test('review server: auth, host, CSRF, XSS escaping, evidence parsing, no publish path',async()=>withServer(async({db,token,port,base})=>{
  assert.equal((await req(base,'/')).status,403,'no cookie');
  const rawStatus=await new Promise((res,rej)=>{const r=http.request({host:'127.0.0.1',port,path:'/',headers:{Host:'evil.example'}},m=>{m.resume();res(m.statusCode);});r.on('error',rej);r.end();});
  assert.equal(rawStatus,421,'DNS-rebinding host');
  assert.equal((await req(base,'/?token=wrong')).status,403);
  const login=await req(base,'/?token='+token);assert.equal(login.status,303);
  const set=login.headers.get('set-cookie');assert.match(set,/HttpOnly/);assert.match(set,/SameSite=Strict/);
  const cookie=set.split(';')[0];
  const id='11111111-1111-4111-8111-111111111111';
  const home=await req(base,'/',{headers:{cookie}});assert.equal(home.status,200);
  const page=await req(base,'/job/'+id,{headers:{cookie}});const html=await page.text();
  assert.equal(page.status,200);
  assert.ok(!html.includes('<script>alert(1)</script>')&&!html.includes('<img src=x'),'untrusted text must be escaped');
  assert.match(html,/&lt;script&gt;/);
  assert.match(page.headers.get('content-security-policy'),/default-src 'none'/);
  assert.match(page.headers.get('cache-control'),/no-store/);
  const csrf=/name="csrf" value="([0-9a-f]{64})"/.exec(html)[1];
  const form=o=>new URLSearchParams(o).toString();
  const post=(p,o,h={})=>req(base,p,{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded',...h},body:form(o)});
  assert.equal((await post(`/job/${id}/claim`,{claim_key:'0123456789abcdef',verdict:'verified'})).status,403,'missing CSRF');
  assert.equal((await post(`/job/${id}/claim`,{csrf:'0'.repeat(64),verdict:'verified'})).status,403,'wrong CSRF');
  assert.equal((await post(`/job/${id}/claim`,{csrf,claim_key:'0123456789abcdef',verdict:'approved!'})).status,400,'bad verdict');
  assert.equal((await post(`/job/${id}/claim`,{csrf,claim_key:'0123456789abcdef',verdict:'verified',evidence:'http://insecure.example'})).status,400,'http evidence');
  assert.equal((await req(base,`/job/${id}/claim`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'})).status,415);
  assert.equal((await req(base,'/job/not-a-uuid',{headers:{cookie}})).status,400);
  assert.equal(db.calls.filter(c=>c.name.startsWith('record_')).length,0,'rejected requests must not reach the database');
  const ok=await post(`/job/${id}/claim`,{csrf,claim_key:'0123456789abcdef',verdict:'verified',evidence:'https://gov.example/s | official_statement',note:'ok'});
  assert.equal(ok.status,303);
  const call=db.calls.find(c=>c.name==='record_claim_review');
  assert.deepEqual(call.args,{p_job_id:id,p_claim_key:'0123456789abcdef',p_verdict:'verified',p_evidence:[{url:'https://gov.example/s',role:'official_statement'}],p_note:'ok',p_reviewer:'Operator A'});
  assert.equal((await post(`/job/${id}/check`,{csrf,item:'names',passed:'true'})).status,303);
  assert.equal((await post(`/job/${id}/check`,{csrf,item:'; drop table',passed:'true'})).status,400);
  assert.equal((await req(base,`/job/${id}/claim`,{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body:'x'.repeat(70000)}).catch(()=>({status:0}))).status===303,false,'oversized body never accepted');
  const names=new Set(db.calls.map(c=>c.name));
  for(const n of names)assert.ok(['media_review_claims','media_review_gate','record_claim_review','record_review_check'].includes(n),'unexpected RPC '+n);
}));
test('review server refuses to start without a strong token or a reviewer name',()=>{
  assert.throws(()=>createReviewApp({db:{},token:'short',reviewer:'x'}),/token/);
  assert.throws(()=>createReviewApp({db:{},token:'t'.repeat(32),reviewer:' '}),/BVAI_REVIEWER/);
});

// ---------- metrics ----------
const sampleReport={summary:{last_successful_ingestion_at:'2026-11-21T00:00:00Z',articles_published_24h:93,stories_skipped_24h:53,stories_duplicate_24h:53,video_jobs_24h:5,video_jobs_rendered_24h:2,video_jobs_failed_24h:3,caption_failures_24h:1,tts_failures_24h:1,render_failures_24h:0,video_duplicate_rejections_24h:0,ai_requests_24h:100,ai_failures_24h:2,ai_chars_24h:1000,tts_chars_this_month:32},
  delivery:[{platform:'youtube',verified_24h:1,queued:0,retrying:0,needs_reconciliation:0,dead_letter:0,oldest_pending_minutes:null}],sources:[{source_name:'Feed A',stale:true}],alerts:[]};
test('metrics: exit codes, dedupe window, report content',()=>{
  assert.equal(exitCodeFor([]),0);assert.equal(exitCodeFor([{severity:'warning'}]),1);assert.equal(exitCodeFor([{severity:'warning'},{severity:'critical'}]),2);
  const a={severity:'critical',code:'x',subject:'y',detail:'d'};
  const first=dedupe([a],{},{now:1000});assert.equal(first.fresh.length,1);
  assert.equal(dedupe([a],first.next,{now:2000}).fresh.length,0,'repeat inside TTL is suppressed');
  assert.equal(dedupe([a],first.next,{now:1000+7*3600*1000}).fresh.length,1,'re-alerts after TTL');
  assert.notEqual(alertId(a),alertId({...a,subject:'z'}));
  const text=render(sampleReport);assert.match(text,/counters, not currency/);assert.match(text,/Feed A/);assert.match(text,/verified24h 1/);
});
test('metrics: unreadable views are never reported healthy; webhook failure escalates',async()=>{
  const bad={from:()=>({select:()=>({single:async()=>({error:{message:'denied'}}),then:r=>r({error:{message:'denied'}})})})};
  const out=[];assert.equal(await run({db:bad,out:s=>out.push(s)}),3);
  const mk=alerts=>({from:t=>({select:()=>{const v=t==='media_pipeline_summary'?sampleReport.summary:t==='media_delivery_health'?sampleReport.delivery:t==='media_source_freshness'?sampleReport.sources:alerts;const r={data:v,error:null};return {single:async()=>r,then:f=>f(r)};}})});
  const stateFile=path.join(tmp,'alerts.json');
  const alerts=[{severity:'critical',code:'ingestion_stale',subject:'news_pipeline',detail:'x'}];
  let sent=0;
  assert.equal(await run({db:mk(alerts),env:{BVAI_ALERT_WEBHOOK_URL:'https://hook.example/x',BVAI_ALERT_STATE:stateFile},fetchImpl:async()=>{sent++;return {ok:true};},out:()=>{}}),2);
  assert.equal(await run({db:mk(alerts),env:{BVAI_ALERT_WEBHOOK_URL:'https://hook.example/x',BVAI_ALERT_STATE:stateFile},fetchImpl:async()=>{sent++;return {ok:true};},out:()=>{}}),2);
  assert.equal(sent,1,'second identical alert is deduplicated');
  fs.rmSync(stateFile,{force:true});
  assert.equal(await run({db:mk(alerts),env:{BVAI_ALERT_WEBHOOK_URL:'https://hook.example/x',BVAI_ALERT_STATE:stateFile},fetchImpl:async()=>({ok:false,status:500}),out:()=>{}}),2);
  assert.equal(await run({db:mk(alerts),env:{BVAI_ALERT_WEBHOOK_URL:'http://plain.example',BVAI_ALERT_STATE:stateFile},out:()=>{}}),2,'http webhook refused');
});

// ---------- Facebook variant ----------
function clip(name,{w=1080,h=1920,secs=10}={}){
  const f=path.join(tmp,name);
  ff('-f','lavfi','-i',`color=c=blue:size=${w}x${h}:rate=5:duration=${secs}`,'-f','lavfi','-i',`sine=frequency=440:duration=${secs}`,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',f);
  return f;
}
test('variant probe: 3–90 s, 1080x1920, H.264+AAC only',{skip:!FFMPEG},()=>{
  assert.equal(probeVariant(clip('ok.mp4',{secs:10})),10);
  assert.throws(()=>probeVariant(clip('long.mp4',{secs:95})),/3–90/);
  assert.throws(()=>probeVariant(clip('wide.mp4',{w:1280,h:720,secs:5})),/1080x1920/);
});
test('registerVariant uploads under variants/ with no overwrite and passes the approver',{skip:!FFMPEG},async()=>{
  const f=clip('fb.mp4',{secs:12});let up,rpc;
  const r=await registerVariant({db:{rpc:async(n,a)=>{rpc={n,a};return {data:true,error:null};}},videoId:'33333333-3333-4333-8333-333333333333',file:f,approvedBy:'Editor',note:'cut',supabaseUrl:'https://p.supabase.co',key:'k',upload:async o=>{up=o;}});
  assert.match(up.storagePath,/^variants\/33333333-3333-4333-8333-333333333333\/facebook-[0-9a-f]{16}\.mp4$/);
  assert.equal(rpc.n,'register_platform_variant');assert.equal(rpc.a.p_approved_by,'Editor');assert.equal(rpc.a.p_sha256.length,64);assert.equal(r.requeued,true);
  await assert.rejects(registerVariant({db:{},videoId:'33333333-3333-4333-8333-333333333333',file:f,approvedBy:' ',upload:async()=>{}}),/approved-by/);
  await assert.rejects(registerVariant({db:{},videoId:'bad',file:f,approvedBy:'x',upload:async()=>{}}),/UUID/);
});


// ---------- integration guards ----------
const claim={job_id:'j',claim_token:'t'};
const frames=Array.from({length:6},(_,i)=>(0x1234567890abcdefn+BigInt(i)).toString(16).padStart(16,'0'));
test('guardVideoClip: reserve, duplicate skip, lease loss, low-information policy, migration-missing policy, modes',async()=>{
  const logs=[];const log=s=>logs.push(s);
  const base={claim,file:'x.mp4',sha256:'a'.repeat(64),sourceUrl:'https://c.example/x',log,extract:()=>frames};
  assert.equal((await guardVideoClip({...base,db:{},reserve:async()=>true,env:{}})).status,'reserved');
  await assert.rejects(guardVideoClip({...base,db:{},reserve:async()=>{throw new Error('Visually near-duplicate clip already used by another video');},env:{}}),/near-duplicate/);
  assert.ok(logs.some(l=>/duplicate_skipped/.test(l)));
  await assert.rejects(guardVideoClip({...base,db:{},reserve:async()=>{throw new Error('Perceptual reservation failed: invalid_perceptual_claim');},env:{}}),/invalid_perceptual_claim/);
  const lowInfo=async()=>{throw new Error('Perceptual reservation failed: insufficient_visual_information');};
  await assert.rejects(guardVideoClip({...base,db:{},reserve:lowInfo,env:{}}),/perceptual_low_information/);
  assert.equal((await guardVideoClip({...base,db:{},reserve:lowInfo,env:{BVAI_PERCEPTUAL_LOW_INFO:'allow'}})).status,'low_information_allowed');
  const missing=async()=>{throw new Error('Perceptual reservation failed: Could not find the function public.reserve_video_perceptual');};
  assert.equal((await guardVideoClip({...base,db:{},reserve:missing,env:{}})).status,'unavailable','auto mode degrades to exact-hash only when the migration is absent');
  await assert.rejects(guardVideoClip({...base,db:{},reserve:missing,env:{BVAI_PERCEPTUAL_DEDUP:'required'}}),/reserve_video_perceptual/,'required mode fails closed');
  assert.equal((await guardVideoClip({...base,db:{},reserve:async()=>{throw new Error('x');},env:{BVAI_PERCEPTUAL_DEDUP:'off'}})).status,'off');
  await assert.rejects(guardVideoClip({...base,db:{},extract:()=>{throw new Error('Too few frames for a perceptual fingerprint');},env:{}}),/perceptual_low_information/);
});
test('captionGuard: shadow never throws, enforce does, checker errors do not fail shadow renders',()=>{
  const ok=fs.readFileSync(path.join(PIPE,'vtt-to-karaoke.py'),'utf8')&&null;
  const bad='[Script Info]\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: K,Noto,60,&H0,&H0,&H0,&H0,0,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.00,K,,0,0,0,,ক্ খবর\n';
  const logs=[];
  const shadow=captionGuard(bad,{env:{},log:s=>logs.push(s)});assert.ok(shadow.problems>0);assert.equal(shadow.mode,'shadow');assert.ok(logs[0].includes('bvai_caption_qc'));
  assert.throws(()=>captionGuard(bad,{env:{BVAI_CAPTION_QC:'enforce'}}),/Caption QC failed/);
  assert.equal(captionGuard(bad,{env:{BVAI_CAPTION_QC:'off'}}).problems,0);
  const boom={toString(){throw new Error('unreadable');},split(){throw new Error('unreadable');}};
  assert.equal(captionGuard(boom,{env:{}}).problems,-1,'checker error in shadow mode is reported, not thrown');
  assert.throws(()=>captionGuard(boom,{env:{BVAI_CAPTION_QC:'enforce'}}));
});
test('facebookVariant: only for masters >90 s, only for the same render, signed path only',async()=>{
  const mk=(row,signErr)=>({from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:row,error:null})})})})}),storage:{from:()=>({createSignedUrl:async p=>signErr?{error:{}}:{data:{signedUrl:'https://s.example/'+p}}})}});
  const row={storage_path:'variants/v/facebook-abc.mp4',duration_sec:'60.000',source_sha256:'m'.repeat(64)};
  assert.deepEqual(await facebookVariant(mk(row),{videoId:'v',masterSha256:'m'.repeat(64),masterDuration:60}),{},'<=90 s master is delivered as is');
  assert.deepEqual(await facebookVariant(mk(null),{videoId:'v',masterSha256:'m'.repeat(64),masterDuration:100}),{},'no variant -> old permanent refusal stays');
  assert.deepEqual(await facebookVariant(mk(row),{videoId:'v',masterSha256:'z'.repeat(64),masterDuration:100}),{},'variant for a different render is ignored');
  assert.deepEqual(await facebookVariant(mk({...row,duration_sec:'95'}),{videoId:'v',masterSha256:'m'.repeat(64),masterDuration:100}),{});
  assert.deepEqual(await facebookVariant(mk(row),{videoId:'v',masterSha256:'m'.repeat(64),masterDuration:100}),{mediaUrl:'https://s.example/variants/v/facebook-abc.mp4',duration:60});
  await assert.rejects(facebookVariant(mk(row,true),{videoId:'v',masterSha256:'m'.repeat(64),masterDuration:100}),/signing failed/);
});

test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
