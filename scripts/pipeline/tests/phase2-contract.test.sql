-- Run on the ISOLATED database after the CI migration subset + 20261110010000 + phase2-fixture.sql + the phase-2 migration.
-- Everything runs in one transaction and rolls back.
BEGIN;
CREATE FUNCTION pg_temp.rhash(seed text,n integer) RETURNS text[] LANGUAGE sql AS $$ SELECT array_agg(substr(md5(seed||i),1,16) ORDER BY i) FROM generate_series(1,n) i $$;
-- flip the lowest 2 bits of the last nibble of every hash: Hamming distance 2 (re-encode-like perturbation)
CREATE FUNCTION pg_temp.perturb(h text[]) RETURNS text[] LANGUAGE sql AS $$ SELECT array_agg(substr(x,1,15)||to_hex((('x'||substr(x,16,1))::bit(4) # B'0101')::int) ORDER BY o) FROM unnest(h) WITH ORDINALITY u(x,o) $$;
CREATE FUNCTION pg_temp.mkjob(status text DEFAULT 'processing') RETURNS TABLE(a uuid,j uuid,t uuid) LANGUAGE plpgsql AS $$
BEGIN
  a:=gen_random_uuid(); j:=gen_random_uuid(); t:=gen_random_uuid();
  INSERT INTO public.articles(id,title_bn,content_bn,status,published_at) VALUES(a,'পরীক্ষা',repeat('সংবাদ ',40),'published',now());
  INSERT INTO public.video_generation_jobs(id,article_id,status,claim_token,lease_expires_at) VALUES(j,a,status,t,now()+interval '1 hour');
  RETURN NEXT;
END $$;
DO $$
DECLARE r1 record;r2 record;r3 record;r4 record;
BEGIN
 SELECT * INTO r1 FROM pg_temp.mkjob(); SELECT * INTO r2 FROM pg_temp.mkjob(); SELECT * INTO r3 FROM pg_temp.mkjob(); SELECT * INTO r4 FROM pg_temp.mkjob();
 IF NOT public.reserve_video_perceptual(r1.j,r1.t,repeat('1',64),'https://commons.example/a',pg_temp.rhash('clipA',12)) THEN RAISE EXCEPTION 'TEST first fingerprint refused'; END IF;
 IF NOT public.reserve_video_perceptual(r1.j,r1.t,repeat('1',64),'https://commons.example/a',pg_temp.rhash('clipA',12)) THEN RAISE EXCEPTION 'TEST same-job replay not idempotent'; END IF;
 BEGIN PERFORM public.reserve_video_perceptual(r2.j,r2.t,repeat('2',64),'https://x/re-encoded',pg_temp.perturb(pg_temp.rhash('clipA',12))); RAISE EXCEPTION 'TEST near-duplicate accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'perceptual_duplicate' THEN RAISE; END IF; END;
 BEGIN PERFORM public.reserve_video_perceptual(r2.j,r2.t,repeat('3',64),'https://x',pg_temp.perturb((pg_temp.rhash('clipA',12))[1:8])); RAISE EXCEPTION 'TEST trimmed duplicate accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'perceptual_duplicate' THEN RAISE; END IF; END;
 IF NOT public.reserve_video_perceptual(r3.j,r3.t,repeat('4',64),'https://commons.example/b',pg_temp.rhash('clipB',12)) THEN RAISE EXCEPTION 'TEST unrelated clip refused'; END IF;
 BEGIN PERFORM public.reserve_video_perceptual(r4.j,r4.t,repeat('5',64),'https://x',ARRAY(SELECT '0000000000000000' FROM generate_series(1,10))); RAISE EXCEPTION 'TEST flat frames accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'insufficient_visual_information' THEN RAISE; END IF; END;
 BEGIN PERFORM public.reserve_video_perceptual(r4.j,r4.t,repeat('5',64),'https://x',ARRAY['zz','yy','xx']); RAISE EXCEPTION 'TEST bad hex accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'invalid_perceptual_fingerprint' THEN RAISE; END IF; END;
 BEGIN PERFORM public.reserve_video_perceptual(r4.j,gen_random_uuid(),repeat('5',64),'https://x',pg_temp.rhash('clipC',5)); RAISE EXCEPTION 'TEST wrong claim token accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'invalid_perceptual_claim' THEN RAISE; END IF; END;
 UPDATE public.video_generation_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=r4.j;
 BEGIN PERFORM public.reserve_video_perceptual(r4.j,r4.t,repeat('5',64),'https://x',pg_temp.rhash('clipC',5)); RAISE EXCEPTION 'TEST expired lease accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'invalid_perceptual_claim' THEN RAISE; END IF; END;
 UPDATE public.video_generation_jobs SET lease_expires_at=now()+interval '1 hour' WHERE id=r4.j;
 UPDATE public.video_generation_jobs SET status='failed' WHERE id=r1.j;
 IF NOT public.reserve_video_perceptual(r4.j,r4.t,repeat('6',64),'https://x',pg_temp.perturb(pg_temp.rhash('clipA',12))) THEN RAISE EXCEPTION 'TEST failed-job fingerprint not released'; END IF;
 IF public.perceptual_overlap(pg_temp.rhash('clipA',12),pg_temp.rhash('clipB',12),10)>0.2 THEN RAISE EXCEPTION 'TEST unrelated overlap too high'; END IF;
 RAISE NOTICE 'PASS 1/5: perceptual dedup (near-duplicate, trimmed, unrelated, flat, invalid hex, fence, expired lease, release)';
END $$;

DO $$
DECLARE r record; v uuid:=gen_random_uuid(); g jsonb; keys text[]; item text; manifest jsonb; sha1 text:=repeat('d',64); sha2 text:=repeat('e',64);
BEGIN
 SELECT * INTO r FROM pg_temp.mkjob('needs_review');
 INSERT INTO public.videos(id,article_id,status) VALUES(v,r.a,'needs_review');
 manifest:=jsonb_build_object('production_plan',jsonb_build_object('excerpts',jsonb_build_array(
   jsonb_build_object('id','excerpt-1','text','মন্ত্রী আজ ঘোষণা দিয়েছেন।'),jsonb_build_object('id','excerpt-2','text','বাজেট  এক লাখ টাকা।'),
   jsonb_build_object('id','excerpt-3','text','মন্ত্রী আজ ঘোষণা দিয়েছেন।')),'display_script','এটি excerpt না থাকলে fallback।'));
 INSERT INTO public.video_delivery_assets(video_id,job_id,sha256,manifest) VALUES(v,r.j,sha1,manifest);
 SELECT array_agg(claim_key ORDER BY ord) INTO keys FROM public.media_review_claims(r.j);
 IF cardinality(keys)<>2 THEN RAISE EXCEPTION 'TEST expected 2 distinct claims (duplicate sentence collapsed), got %',cardinality(keys); END IF;
 IF public.media_claim_key('বাজেট এক   লাখ টাকা।')<>keys[2] THEN RAISE EXCEPTION 'TEST claim key must ignore whitespace runs'; END IF;
 g:=public.media_review_gate(r.j);
 IF (g->>'ok')::boolean OR jsonb_array_length(g->'blockers')<>13 THEN RAISE EXCEPTION 'TEST fresh job must block on 2 claims + 11 checks, got %',g; END IF;
 BEGIN PERFORM public.record_claim_review(r.j,keys[1],'verified','[]','','editor'); RAISE EXCEPTION 'TEST verified without evidence accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'verified_requires%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.record_claim_review(r.j,keys[1],'verified','[{"url":"https://a.example/1","role":"news_source"},{"url":"https://b.example/2","role":"news_source"}]','','editor'); RAISE EXCEPTION 'TEST two unconfirmed domains accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'verified_requires%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.record_claim_review(r.j,keys[1],'verified','[{"url":"http://a.example/1","role":"primary_document"}]','','editor'); RAISE EXCEPTION 'TEST http evidence accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'evidence_url_must_be_https' THEN RAISE; END IF; END;
 BEGIN PERFORM public.record_claim_review(r.j,keys[1],'verified','[{"url":"https://a.example/1","role":"blog"}]','','editor'); RAISE EXCEPTION 'TEST bad role accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'invalid_evidence_role' THEN RAISE; END IF; END;
 BEGIN PERFORM public.record_claim_review(r.j,'0123456789abcdef','unverified','[]','','editor'); RAISE EXCEPTION 'TEST unknown claim accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'unknown_claim_for_job' THEN RAISE; END IF; END;
 BEGIN PERFORM public.record_claim_review(r.j,keys[1],'verified','[{"url":"https://a.example/1","role":"primary_document"}]','','  '); RAISE EXCEPTION 'TEST blank reviewer accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM public.record_claim_review(r.j,keys[1],'verified','[{"url":"https://gov.example/statement","role":"official_statement"}]','','editor');
 PERFORM public.record_claim_review(r.j,keys[2],'disputed','[]','sources disagree','editor');
 FOREACH item IN ARRAY ARRAY['names','numbers','dates','sources','pronunciation','scene_relevance','captions','audio_level','safe_zone','copyright','disclosure'] LOOP PERFORM public.record_review_check(r.j,item,true,'editor'); END LOOP;
 g:=public.media_review_gate(r.j);
 IF (g->>'ok')::boolean OR NOT (g->'blockers') @> jsonb_build_array(jsonb_build_object('code','claim_disputed','claim_key',keys[2],'verdict','disputed')) THEN RAISE EXCEPTION 'TEST disputed claim must block, got %',g; END IF;
 PERFORM public.record_claim_review(r.j,keys[2],'verified','[{"url":"https://a.example/1","role":"news_source","independent_confirmed":true},{"url":"https://b.example/2","role":"news_source","independent_confirmed":true}]','resolved','editor');
 IF NOT (public.media_review_gate(r.j)->>'ok')::boolean THEN RAISE EXCEPTION 'TEST fully reviewed job should pass, got %',public.media_review_gate(r.j); END IF;
 PERFORM public.record_review_check(r.j,'safe_zone',false,'editor','text under UI');
 IF (public.media_review_gate(r.j)->>'ok')::boolean THEN RAISE EXCEPTION 'TEST failed checklist item must re-block'; END IF;
 PERFORM public.record_review_check(r.j,'safe_zone',true,'editor');
 IF NOT (public.media_review_gate(r.j)->>'ok')::boolean THEN RAISE EXCEPTION 'TEST should pass again'; END IF;
 -- A re-render produces a new sha256: every earlier verdict and tick must stop counting
 UPDATE public.video_delivery_assets SET sha256=sha2 WHERE job_id=r.j;
 g:=public.media_review_gate(r.j);
 IF (g->>'ok')::boolean OR jsonb_array_length(g->'blockers')<>13 THEN RAISE EXCEPTION 'TEST re-render must invalidate all reviews, got %',g; END IF;
 -- fallback path for older assets without excerpts
 UPDATE public.video_delivery_assets SET manifest=jsonb_build_object('claim_script','প্রথম বাক্য। দ্বিতীয় বাক্য?') WHERE job_id=r.j;
 IF (SELECT count(*) FROM public.media_review_claims(r.j))<>2 THEN RAISE EXCEPTION 'TEST fallback split failed'; END IF;
 RAISE NOTICE 'PASS 2/5: claim review gate (evidence rules, disputed blocks, checklist, sha-binding, fallback)';
END $$;

DO $$
DECLARE r record; v uuid:=gen_random_uuid(); n integer; st text; cp text;
BEGIN
 SELECT * INTO r FROM pg_temp.mkjob('completed');
 INSERT INTO public.videos(id,article_id,status) VALUES(v,r.a,'published');
 INSERT INTO public.video_delivery_assets(video_id,job_id,sha256,manifest) VALUES(v,r.j,repeat('d',64),'{}');
 INSERT INTO public.video_delivery_outbox(video_id,platform,account_id,status,last_error,checkpoint) VALUES(v,'facebook','123','dead_letter','Verified Facebook Reels API contract is 3–90 seconds; 91–120s master needs a separate approved edit','{}');
 BEGIN PERFORM public.register_platform_variant(v,'facebook','variants/x/fb.mp4',repeat('9',64),9000,95,'editor'); RAISE EXCEPTION 'TEST 95s variant accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.register_platform_variant(v,'facebook','variants/x/fb.mp4',repeat('d',64),9000,60,'editor'); RAISE EXCEPTION 'TEST variant equal to master accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.register_platform_variant(v,'facebook','../escape.mp4',repeat('9',64),9000,60,'editor'); RAISE EXCEPTION 'TEST path traversal accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF NOT public.register_platform_variant(v,'facebook','variants/x/fb.mp4',repeat('9',64),9000,60,'editor','reviewed cut') THEN RAISE EXCEPTION 'TEST dead-lettered row not requeued'; END IF;
 SELECT status INTO st FROM public.video_delivery_outbox WHERE video_id=v; IF st<>'retrying' THEN RAISE EXCEPTION 'TEST expected retrying got %',st; END IF;
 -- a row WITH a checkpoint (provider identity may exist) is never requeued
 SELECT * INTO r FROM pg_temp.mkjob('completed'); v:=gen_random_uuid();
 INSERT INTO public.videos(id,article_id,status) VALUES(v,r.a,'published');
 INSERT INTO public.video_delivery_assets(video_id,job_id,sha256,manifest) VALUES(v,r.j,repeat('c',64),'{}');
 INSERT INTO public.video_delivery_outbox(video_id,platform,account_id,status,last_error,checkpoint) VALUES(v,'facebook','123','dead_letter','needs a separate approved edit','{"upload_session_id":"abc"}');
 IF public.register_platform_variant(v,'facebook','variants/y/fb.mp4',repeat('8',64),9000,60,'editor') THEN RAISE EXCEPTION 'TEST checkpointed row requeued'; END IF;
 SELECT status,checkpoint->>'upload_session_id' INTO st,cp FROM public.video_delivery_outbox WHERE video_id=v;
 IF st<>'dead_letter' OR cp<>'abc' THEN RAISE EXCEPTION 'TEST checkpointed row touched'; END IF;
 BEGIN PERFORM public.register_platform_variant(gen_random_uuid(),'facebook','variants/z.mp4',repeat('7',64),1,60,'editor'); RAISE EXCEPTION 'TEST variant for unknown video accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'master_asset_missing' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS 3/5: Facebook variant registry (<=90 s, not master, safe path, checkpoint never touched)';
END $$;

DO $$
DECLARE codes text[]; r record; v uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.news_sources(id,name,enabled,kill_switch,interval_minutes,consecutive_failures,last_probe_at) VALUES(gen_random_uuid(),'Stale Feed',true,false,14,0,now()-interval '5 hours'),(gen_random_uuid(),'Fresh Feed',true,false,14,0,now()-interval '5 minutes');
 INSERT INTO public.news_pipeline_runs(stage,status,completed_at) VALUES('cron','success',now()-interval '2 hours');
 SELECT array_agg(code ORDER BY code) INTO codes FROM public.media_alerts;
 IF NOT codes @> ARRAY['ingestion_stale','source_stale'] THEN RAISE EXCEPTION 'TEST expected stale alerts, got %',codes; END IF;
 IF (SELECT count(*) FROM public.media_source_freshness WHERE stale)<>1 THEN RAISE EXCEPTION 'TEST only the stale feed should be stale'; END IF;
 INSERT INTO public.news_pipeline_runs(stage,status,completed_at) VALUES('cron','success',now());
 SELECT array_agg(code) INTO codes FROM public.media_alerts WHERE code='ingestion_stale';
 IF codes IS NOT NULL THEN RAISE EXCEPTION 'TEST fresh ingestion must clear alert'; END IF;
 SELECT * INTO r FROM pg_temp.mkjob('completed'); INSERT INTO public.videos(id,article_id,status) VALUES(v,r.a,'published');
 INSERT INTO public.video_delivery_outbox(video_id,platform,account_id,status,next_attempt_at,updated_at) VALUES(v,'youtube','chan','retrying',now()-interval '1 hour',now()),(v,'facebook','pg','needs_reconciliation',now(),now()-interval '3 hours');
 SELECT array_agg(code) INTO codes FROM public.media_alerts WHERE code IN ('outbox_overdue','needs_reconciliation','no_verified_publication_24h');
 IF cardinality(codes)<>4 THEN RAISE EXCEPTION 'TEST expected 4 delivery alert rows, got %',codes; END IF;
 -- success without verified_at must not count as verified publication
 UPDATE public.video_delivery_outbox SET status='succeeded',result='{"id":"yt1"}' WHERE platform='youtube';
 IF (SELECT verified_24h FROM public.media_delivery_health WHERE platform='youtube')<>0 THEN RAISE EXCEPTION 'TEST unverified success counted'; END IF;
 UPDATE public.video_delivery_outbox SET result='{"id":"yt1","verified_at":"2026-11-21T00:00:00Z"}' WHERE platform='youtube';
 IF (SELECT verified_24h FROM public.media_delivery_health WHERE platform='youtube')<>1 THEN RAISE EXCEPTION 'TEST verified success not counted'; END IF;
 PERFORM * FROM public.media_pipeline_summary;
 RAISE NOTICE 'PASS 4/5: metrics views and alert rules';
END $$;

DO $$
DECLARE denied integer:=0; o text; role_name text; f record;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
            AND p.proname IN ('perceptual_overlap','reserve_video_perceptual','media_claim_key','media_review_claims','record_claim_review','record_review_check','media_review_gate','register_platform_variant') LOOP
     IF has_function_privilege(role_name,f.sig,'EXECUTE') THEN RAISE EXCEPTION 'TEST % can execute %',role_name,f.sig; END IF; denied:=denied+1;
   END LOOP;
   FOREACH o IN ARRAY ARRAY['video_perceptual_fingerprints','video_claim_reviews','video_review_checks','video_delivery_variants','media_source_freshness','media_delivery_health','media_pipeline_summary','media_alerts'] LOOP
     IF has_table_privilege(role_name,'public.'||o,'SELECT') THEN RAISE EXCEPTION 'TEST % can read %',role_name,o; END IF; denied:=denied+1;
   END LOOP;
 END LOOP;
 IF NOT has_function_privilege('service_role','public.media_review_gate(uuid)','EXECUTE') THEN RAISE EXCEPTION 'TEST service_role lost gate'; END IF;
 RAISE NOTICE 'PASS 5/5: % client-role denials verified', denied;
END $$;
ROLLBACK;
