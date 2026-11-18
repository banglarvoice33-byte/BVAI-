import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {refreshEvidence} from '../source-evidence.mjs';
import {collectCommonsVideo,allowedLicense} from '../commons-media.mjs';
import {cleanupDownloadedMedia} from '../media-cleanup.mjs';
import {parseLoudness} from '../audio-qc.mjs';
import {buildVoiceScript,CLOSING_CTA} from '../generate-video.js';
const trusted={status:'published',origin:'aggregated',source_id:'source',source_name:'Test source',source_url:'https://news.example/story',source_published_at:new Date().toISOString(),verification_status:'auto_verified',content_bn:'বাংলা সংবাদে তথ্য যাচাই করা জরুরি। পরীক্ষার সংবাদে তারিখ এবং স্থান যথাযথভাবে উল্লেখ করা হয়েছে।'};
const fetcher=async url=>({bytes:Buffer.from('source evidence'),url,headers:new Headers()});
test('trusted one-source policy is honored at fresh evidence fetch, not just precheck',async()=>{
 const evidence=await refreshEvidence(trusted,'website',{fetcher});assert.equal(evidence.filter(e=>e.sha256).length,1);
});
test('human-approved original content has no external multi-source quota; trusted-source fetch still required',async()=>{
 const own=await refreshEvidence({...trusted,origin:'manual',human_verified:true,verification_status:'verified'},'website',{fetcher});assert.equal(own.filter(e=>e.sha256).length,1);
 await assert.rejects(()=>refreshEvidence(trusted,'website',{fetcher:async()=>{throw new Error('HTTP 503');}}),/Fewer than 1/);
});
test('automated licensing rejects NC ND SA unknown or misleading BY license URLs',()=>{
 for(const name of ['CC BY-SA 4.0','CC BY-NC 4.0','CC BY-ND 4.0','Public domain','Copyrighted'])assert.equal(allowedLicense({LicenseShortName:{value:name}}),null);
 assert.equal(allowedLicense({LicenseShortName:{value:'CC BY 4.0'},LicenseUrl:{value:'https://evil.test/licenses/by/4.0/'}}),null);
 assert.ok(allowedLicense({LicenseShortName:{value:'CC BY 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/4.0/'}}));
});
test('Commons downloader is bounded reserves original hash and records symbolic video attribution',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bvai-commons-'));const bytes=Buffer.alloc(4096,1);const reservations=[];
 const page={pageid:123,imageinfo:[{url:'https://upload.wikimedia.org/wikipedia/commons/a/a1/Test.webm',descriptionurl:'https://commons.wikimedia.org/wiki/File:Test.webm',size:4096,extmetadata:{Artist:{value:'Test creator'},LicenseShortName:{value:'CC BY 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/4.0/'}}}]};
 const db={rpc:async(name,args)=>{reservations.push({name,args});return {error:null};}};
 const mock=async(url,options)=>{if(url.includes('api.php'))return {bytes:Buffer.from(JSON.stringify({query:{pages:[page]}}))};assert.equal(options.maxBytes,12*1024*1024);return {bytes};};
 try{const media=await collectCommonsVideo({title_bn:'পরীক্ষা'},{folder,db,jobId:'j',claimToken:'t',fetcher:mock});assert.equal(media.length,1);assert.equal(media[0].type,'symbolic_video');assert.equal(reservations[0].name,'reserve_video_broll');assert.equal(reservations[0].args.p_sha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(fs.existsSync(media[0].path));}
 finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('cleanup deletes only checksum-matched downloaded clips, not output or escaped paths',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bvai-cleanup-'));
 try{const clip=path.join(root,'broll-0.webm'),render=path.join(root,'final_output.mp4');fs.writeFileSync(clip,'source');fs.writeFileSync(render,'render');
 const sha256=createHash('sha256').update('source').digest('hex');
 const receipt=cleanupDownloadedMedia({media:[{path:clip,sha256},{path:render,sha256}]},{root});
 assert.ok(receipt[0].deleted_at);assert.ok(receipt[1].cleanup_error);assert.ok(fs.existsSync(render));assert.equal(fs.existsSync(clip),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('narration always retains exact closing CTA and never invents date or impacts',()=>{
 const text=buildVoiceScript({...trusted,title_bn:'পরীক্ষার সংবাদ'});assert.ok(text.endsWith(CLOSING_CTA));assert.doesNotMatch(text,/আনন্দ ছড়িয়ে|জটিল হয়েছে|আজ \d/);
});
test('loudness parser rejects silence and missing measurement',()=>{
 assert.throws(()=>parseLoudness('no report'));
 assert.throws(()=>parseLoudness('{"input_i":"-inf","input_tp":"-inf"}'));
 assert.equal(parseLoudness('{"input_i":"-14.1","input_tp":"-1.5"}').input_i,'-14.1');
});

import {isCoverageSlot} from '../local-slot.mjs';
test('local coverage slots use Dhaka time independent of host timezone',()=>{
 assert.equal(isCoverageSlot(new Date('2026-11-11T01:17:00Z')),true);
 assert.equal(isCoverageSlot(new Date('2026-11-11T17:17:00Z')),true);
 assert.equal(isCoverageSlot(new Date('2026-11-11T18:17:00Z')),false);
 assert.equal(isCoverageSlot(new Date('2026-11-11T01:18:00Z')),false);
});

import {isMotionMedia} from '../generate-video.js';
import {archiveTerminalClaim} from '../local-recovery.mjs';
test('Commons WebM/OGV inputs are motion streams, never image loop arguments',()=>{
 for(const file of ['broll.webm','broll.ogv','broll.mp4'])assert.equal(isMotionMedia(file),true);
 assert.equal(isMotionMedia('overlay.png'),false);
});
test('terminal failed local claim is archived without deleting evidence, live lease stays blocked',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bvai-state-')),root=path.join(folder,'temp'),backupRoot=path.join(folder,'backups');
 const id='00000000-0000-0000-0000-000000000001';
 try{
 fs.mkdirSync(path.join(root,id),{recursive:true});fs.writeFileSync(path.join(root,id,'evidence.txt'),'retained');
 fs.writeFileSync(path.join(root,'claim.json'),JSON.stringify({job_id:id,claim_token:'token'}));
 const client=status=>({from:()=>({select:()=>({eq:()=>({single:async()=>({data:{status,claim_token:'token'},error:null})})})})});
 await assert.rejects(()=>archiveTerminalClaim(client('processing'),{root,backupRoot}),/lease/);
 assert.ok(fs.existsSync(path.join(root,'claim.json')));
 await archiveTerminalClaim(client('failed'),{root,backupRoot});
 assert.equal(fs.existsSync(path.join(root,'claim.json')),false);
 const archived=fs.readdirSync(backupRoot)[0];assert.equal(fs.readFileSync(path.join(backupRoot,archived,id,'evidence.txt'),'utf8'),'retained');
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
