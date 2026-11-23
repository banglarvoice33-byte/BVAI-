// Disposable PostgreSQL engine. Actual supplied legacy media finalizer + new migrations;
// all three supplied finalizer function bodies are exercised against representative tables. Never reads .env or any remote database.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const root=new URL('../../../../supabase/migrations/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,root),'utf8');
const actor='11111111-1111-4111-8111-111111111111',article='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',token='55555555-5555-4555-8555-555555555555',source='66666666-6666-4666-8666-666666666666';
let video;
const storagePath=`${article}/${job}-${'a'.repeat(32)}.mp4`;
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${actor}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
CREATE FUNCTION public.current_app_role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('test.role',true)$$;
CREATE TABLE articles(id uuid PRIMARY KEY,status text,origin text,field_report_id uuid,source_id uuid,source_name text,source_url text,source_published_at timestamptz,human_verified boolean,verification_status text,content_bn text,title_bn text,featured_image text,editorial_status text,workflow_status text,review_reason text,published_at timestamptz,video_generated boolean,video_generated_at timestamptz,updated_at timestamptz,title_en text,category text,thumbnail_url text);
CREATE TABLE news_sources(id uuid PRIMARY KEY,enabled boolean,kill_switch boolean);
CREATE TABLE video_generation_jobs(id uuid PRIMARY KEY,article_id uuid,claim_token uuid,status text,lease_expires_at timestamptz,video_id uuid,render_path text,updated_at timestamptz,error_message text);
CREATE TABLE videos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),article_id uuid,status text,description_bn text,updated_at timestamptz,title_bn text,title_en text,category_key text,thumbnail_url text,video_url text,source_url text,duration_sec integer,duration_seconds integer);
CREATE TABLE video_generation_assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,kind text,provider text,external_id text,url text,license text,metadata jsonb);
CREATE TABLE video_delivery_assets(video_id uuid PRIMARY KEY,job_id uuid UNIQUE,sha256 text,manifest jsonb);
CREATE TABLE video_quality_approvals(job_id uuid PRIMARY KEY,video_sha256 text,script_sha256 text,reviewer_id uuid,review jsonb,reviewed_at timestamptz,expires_at timestamptz);
CREATE TABLE video_story_reservations(job_id uuid,script_hash text,content_key text);
CREATE TABLE video_delivery_outbox(video_id uuid,platform text,account_id text,CONSTRAINT video_delivery_outbox_video_id_platform_account_id_key UNIQUE(video_id,platform,account_id));
INSERT INTO news_sources VALUES('${source}',true,false);
INSERT INTO articles(id,status,origin,source_id,source_name,source_url,source_published_at,human_verified,verification_status,content_bn,title_bn) VALUES('${article}','published','aggregated','${source}','BBC Bangla','https://www.bbc.com/bengali/story',now(),false,'auto_verified','বাংলা সংবাদের বিষয়বস্তু','পরীক্ষার সংবাদ');
INSERT INTO video_generation_jobs VALUES('${job}','${article}','${token}','processing',now()+interval '1 hour',NULL,NULL,now(),NULL);
INSERT INTO video_story_reservations VALUES('${job}','display-hash','content-key');
`);
const base=read('20261108012807_harden_video_pipeline_transactions.sql');
await db.exec(base.slice(base.indexOf('CREATE OR REPLACE FUNCTION public.finalize_video_generation_job('),base.indexOf('CREATE OR REPLACE FUNCTION public.fail_video_generation_job(')));
const website=read('20261109060000_website_only_video_delivery.sql');
await db.exec(website.slice(website.indexOf('CREATE OR REPLACE FUNCTION public.finalize_website_video('),website.indexOf('REVOKE ALL ON FUNCTION public.finalize_website_video(')));
const legacy=read('20261110000000_media_delivery_reliability.sql');
await db.exec(legacy.slice(legacy.indexOf('CREATE OR REPLACE FUNCTION public.finalize_media_delivery('),legacy.indexOf('CREATE OR REPLACE FUNCTION public.claim_media_delivery(')));
await check('enhanced migrations apply and replay transactionally',async()=>{for(let i=0;i<2;i++){await db.exec(read('20261116000000_enhanced_video_policy.sql'));await db.exec(read('20261116001000_video_experiments.sql'));}});
const manifest=()=>({caption_method:'groq-whisper',script_hash:'display-hash',content_key:'content-key',spoken_script_hash:'b'.repeat(64),render_duration:60,evidence:[{role:'news_source',url:'https://www.bbc.com/bengali/story',sha256:'c'.repeat(64),fetched_at:new Date().toISOString()}],technical_qc:{version:1,policy_version:'2026-11-16.v2',video_sha256:'a'.repeat(64),script_sha256:'b'.repeat(64),inspected_at:new Date().toISOString(),checks:Object.fromEntries(['master','decode','loudness','captions','rights','source_credit','script_binding'].map(k=>[k,true])),measured:{integrated_lufs:-14,true_peak_dbtp:-1.4,duration_sec:60}},media:[]});
const finalize=(m,publish=true,targets=[])=>db.query('SELECT * FROM finalize_media_delivery($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[job,article,token,storagePath,'https://storage.example/private',60,'a'.repeat(64),100000,publish,JSON.stringify(m),JSON.stringify(targets)]);
await check('trusted source publishes WITHOUT human attestation or three independent sources',async()=>{const result=await finalize(manifest());video=result.rows[0].video_id;assert.equal((await db.query('SELECT status FROM videos')).rows[0].status,'published');});
await check('idempotent repeat does not create duplicate delivery targets',async()=>{for(let i=0;i<2;i++)await finalize(manifest(),true,[{platform:'youtube',account_id:'channel'}]);assert.equal((await db.query('SELECT count(*)::int n FROM video_delivery_outbox')).rows[0].n,1);assert.equal((await db.query("SELECT count(*)::int n FROM video_pipeline_events WHERE event_type='video_published'")).rows[0].n,1);});
await check('service runner cannot bypass human approval RPC',async()=>{assert.equal((await db.query("SELECT has_function_privilege('service_role','public.record_video_quality_review(uuid,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);assert.equal((await db.query("SELECT has_function_privilege('service_role','public.approve_reporter_article(uuid,text)','EXECUTE') allowed")).rows[0].allowed,false);});
await check('old finalizer is no longer a directly callable bypass',async()=>{assert.equal((await db.query("SELECT has_function_privilege('service_role','public.finalize_media_delivery_v1(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);});
for(const [name,mutate,regex] of [
 ['missing report',m=>delete m.technical_qc,/technical_report/],
 ['changed video hash',m=>m.technical_qc.video_sha256='d'.repeat(64),/technical_report/],
 ['changed script hash',m=>m.technical_qc.script_sha256='d'.repeat(64),/technical_report/],
 ['failed captions',m=>m.technical_qc.checks.captions=false,/technical_check/],
 ['missing rights',m=>delete m.technical_qc.checks.rights,/technical_check/],
 ['stale report',m=>m.technical_qc.inspected_at='2020-01-01',/technical_report/],
 ['future report',m=>m.technical_qc.inspected_at='2099-01-01',/technical_report/],
 ['bad loudness',m=>m.technical_qc.measured.integrated_lufs=-25,/measurements/],
 ['bad peak',m=>m.technical_qc.measured.true_peak_dbtp=1,/measurements/],
 ['wrong credited evidence',m=>m.evidence[0].url='https://other.example/story',/credited_source/],
 ['stale source capture',m=>m.evidence[0].fetched_at='2020-01-01',/credited_source/],
])await check(name+' blocks public publication',async()=>{const m=manifest();mutate(m);await assert.rejects(finalize(m),regex);});
await check('changing a published asset outside finalizer is blocked at commit',async()=>{await assert.rejects(db.exec("UPDATE video_delivery_assets SET sha256=repeat('d',64)"),/technical_report/);});
await check('deleting the binding of a published asset is blocked',async()=>{await assert.rejects(db.exec('DELETE FROM video_delivery_assets'),/technical_report/);});
await check('kill-switched source cannot use automatic route',async()=>{await db.exec('UPDATE news_sources SET kill_switch=true');await assert.rejects(finalize(manifest()),/editorial_authorization/);await db.exec('UPDATE news_sources SET kill_switch=false');});
await check('stale source publication is distinct from fresh technical inspection',async()=>{await db.exec("UPDATE articles SET source_published_at=now()-interval '2 days'");await assert.rejects(finalize(manifest()),/primary_source_stale/);await db.exec('UPDATE articles SET source_published_at=now()');});
// Unpublish before changing to a reporter article; no real asset or external media is touched.
await db.exec("UPDATE videos SET status='needs_review';UPDATE articles SET origin='manual',field_report_id='77777777-7777-4777-8777-777777777777',human_verified=false,verification_status='pending',status='pending'");
await check('reporter data cannot enter automatic source route',async()=>{assert.equal((await db.query('SELECT video_gate_basis($1) basis',[article])).rows[0].basis,null);await assert.rejects(finalize(manifest()),/source_article_not_published/);});
await check('reporter article and photo publication is held without explicit human approval',async()=>{await db.exec("UPDATE articles SET status='published',featured_image='private-photo.jpg'");assert.equal((await db.query('SELECT status FROM articles')).rows[0].status,'pending');});
await check('unauthenticated editorial instruction fails',async()=>{await assert.rejects(db.query('SELECT * FROM approve_reporter_article($1,$2)',[article,'reviewed']),/authenticated_editor/);});
await check('an automation writer cannot manufacture a human-approved reporter flag',async()=>{await db.exec("UPDATE articles SET human_verified=true,verification_status='verified',status='published'");const row=(await db.query('SELECT human_verified,status FROM articles')).rows[0];assert.equal(row.human_verified,false);assert.equal(row.status,'pending');});
await check('automation cannot disguise a field report as an aggregated source',async()=>{await db.exec("UPDATE articles SET origin='aggregated',field_report_id=NULL");const row=(await db.query('SELECT origin,field_report_id FROM articles')).rows[0];assert.equal(row.origin,'manual');assert.ok(row.field_report_id);});
await db.exec(`SET test.actor='${actor}';SET test.role='desk_editor';`);
await check('authenticated editor can approve article with audit trail',async()=>{await db.query('SELECT * FROM approve_reporter_article($1,$2)',[article,'সম্পাদকের নির্দিষ্ট নির্দেশনায় অনুমোদিত']);assert.equal((await db.query('SELECT video_gate_basis($1) basis',[article])).rows[0].basis,'editorial');assert.equal((await db.query("SELECT count(*)::int n FROM video_pipeline_events WHERE event_type='article_editor_approved'")).rows[0].n,1);});
await check('approved reporter article still requires approval of the actual video',async()=>{await assert.rejects(finalize(manifest()),/human_approval/);});
const review=()=>({version:2,reviewer_id:actor,reviewed_at:new Date().toISOString(),video_sha256:'a'.repeat(64),script_sha256:'b'.repeat(64),duration_sec:60,editorial_authorized:true,editorial_note:'নিজে সম্পূর্ণ ভিডিও ও সংবাদ পরীক্ষা করে অনুমোদন দিলাম।',qc:Object.fromEntries(['names_numbers_dates','pronunciation','scene_relevance','caption_spelling','safe_zones','rights','human_perceptual_qc'].map(k=>[k,true]))});
const record=r=>db.query('SELECT record_video_quality_review($1,$2)',[job,JSON.stringify(r)]);
await check('forged editor ID cannot approve a video',async()=>{await assert.rejects(record({...review(),reviewer_id:video}),/asset_bound/);});
await check('missing explicit editorial decision cannot approve a video',async()=>{await assert.rejects(record({...review(),editorial_authorized:false}),/explicit_editorial/);});
await check('human video approval does not need three external sources',async()=>{await record(review());const m=manifest();m.evidence=[];await finalize(m);assert.equal((await db.query('SELECT status FROM videos')).rows[0].status,'published');});
await check('expired human video approval is not reusable',async()=>{await db.exec("UPDATE video_quality_approvals SET expires_at=now()-interval '1 second'");await assert.rejects(finalize(manifest()),/human_approval/);await db.exec("UPDATE videos SET description_bn='receipt reconciliation remains possible'");await record(review());});
await check('review mode cannot accidentally enqueue public targets',async()=>{await assert.rejects(finalize(manifest(),false,[{platform:'youtube',account_id:'channel'}]),/review_cannot_distribute/);});
await check('experiment RPC is not writable by public or signed-in clients',async()=>{for(const role of ['anon','authenticated'])assert.equal((await db.query(`SELECT has_function_privilege('${role}','public.record_video_experiment_event(text,text,uuid,text,text,text)','EXECUTE') allowed`)).rows[0].allowed,false);});
await check('invalid experiment weights are rejected by PostgreSQL',async()=>{await assert.rejects(db.exec("INSERT INTO video_experiments(id,variants) VALUES('bad','[{\"id\":\"a\",\"weight\":1},{\"id\":\"b\",\"weight\":1}]')"),/weights_must_total/);});
await db.exec(`INSERT INTO video_experiments(id,status,variants) VALUES('pacing','running','[{"id":"a","weight":5000},{"id":"b","weight":5000}]')`);
const ev=(event,key,variant='a')=>db.query('SELECT record_video_experiment_event($1,$2,$3,$4,$5,$6) ok',['pacing','1'.repeat(64),video,variant,event,key.repeat(64)]);
await check('click requires a real earlier exposure',async()=>{await assert.rejects(ev('click','2'),/exposure_required/);});
await check('exposures deduplicate across repeated event keys',async()=>{assert.equal((await ev('exposure','1')).rows[0].ok,true);assert.equal((await ev('exposure','1')).rows[0].ok,false);assert.equal((await ev('exposure','3')).rows[0].ok,false);assert.equal((await ev('click','2')).rows[0].ok,true);});
await check('exposed experiment definitions are immutable',async()=>{await assert.rejects(db.exec("UPDATE video_experiments SET variants='[{\"id\":\"a\",\"weight\":6000},{\"id\":\"b\",\"weight\":4000}]'"),/definition_immutable/);});
await check('subject cannot silently switch experiment variant',async()=>{await assert.rejects(ev('exposure','4','b'),/assignment_changed/);});
await check('stopped experiment rejects new telemetry',async()=>{await db.exec("UPDATE video_experiments SET status='stopped'");await assert.rejects(ev('complete','5'),/not_running/);});
await check('coordinated rollback restores legacy functions while retaining audit data',async()=>{const rollback=fs.readFileSync(new URL('../../../../supabase/rollbacks/20261116000000_enhanced_video_policy.sql',import.meta.url),'utf8');await db.exec(rollback);assert.equal((await db.query("SELECT to_regprocedure('public.finalize_media_delivery_v1(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb)') old")).rows[0].old,null);assert.ok((await db.query('SELECT count(*)::int n FROM video_pipeline_events')).rows[0].n>0);});
await check('enhanced migrations can be reapplied after rollback',async()=>{await db.exec(read('20261116000000_enhanced_video_policy.sql'));await db.exec(read('20261116001000_video_experiments.sql'));});
await db.close();console.log(`Enhanced PostgreSQL checks passed: ${passed}. Scope: isolated representative tables + all three actual supplied finalizers; not full hosted schema, network or real storage.`);
