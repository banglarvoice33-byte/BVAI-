-- Run against the isolated bootstrap database AFTER the four baseline migrations and new migration.
BEGIN;
DO $$
DECLARE a uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid(); j uuid; token uuid; v uuid;
 q public.video_delivery_outbox%ROWTYPE; renewed uuid; result record; evidence jsonb; manifest jsonb; n integer;
BEGIN
 INSERT INTO public.articles(id,title_bn,content_bn,status,published_at,category,human_verified,verification_status,source_published_at)
 VALUES(a,'পরীক্ষা',repeat('বাংলা সংবাদ ',40),'published',now(),'national',true,'verified',now());
 SELECT job_id,claim_token INTO j,token FROM public.claim_reviewed_video_job(a);
 IF j IS NULL THEN RAISE EXCEPTION 'TEST claim missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.claim_video_generation_job(a)) THEN RAISE EXCEPTION 'TEST duplicate article claimed'; END IF;
 PERFORM public.reserve_video_story(j,token,repeat('a',64),repeat('b',64),'পূর্ণ তথ্য');
 PERFORM public.reserve_video_broll(j,token,repeat('9',64),'https://commons.wikimedia.org/wiki/File:Test.webm');
 evidence=jsonb_build_array(jsonb_build_object('role','news_source','sha256',repeat('e',64),'fetched_at',now()),jsonb_build_object('role','news_source','sha256',repeat('f',64),'fetched_at',now()));
 manifest=jsonb_build_object('content_key',repeat('a',64),'script_hash',repeat('b',64),'caption_method','groq-whisper','evidence',evidence,'claim_token',token,'video_path','SECRET_LOCAL_PATH');
 SELECT * INTO result FROM public.finalize_media_delivery(j,a,token,a::text||'/'||j::text||'-'||repeat('c',32)||'.mp4','https://storage.example/signed',60,repeat('d',64),10000,true,manifest,'[{"platform":"youtube","account_id":"UCtest"},{"platform":"facebook","account_id":"123"}]');
 v=result.video_id;
 IF result.job_status<>'completed' THEN RAISE EXCEPTION 'TEST not completed'; END IF;
 IF (SELECT video_generated_at IS NULL FROM public.articles WHERE id=a) THEN RAISE EXCEPTION 'TEST article timestamp missing'; END IF;
 IF (SELECT video_id IS NOT NULL FROM public.articles WHERE id=a) THEN RAISE EXCEPTION 'TEST external video_id corrupted'; END IF;
 IF (SELECT d.manifest ? 'claim_token' OR d.manifest ? 'video_path' FROM public.video_delivery_assets d WHERE d.video_id=v) THEN RAISE EXCEPTION 'TEST secret leaked'; END IF;
 SELECT * INTO result FROM public.finalize_media_delivery(j,a,token,a::text||'/'||j::text||'-'||repeat('c',32)||'.mp4','https://storage.example/signed',60,repeat('d',64),10000,true,manifest,'[{"platform":"youtube","account_id":"UCtest"}]');
 SELECT count(*) INTO n FROM public.video_delivery_outbox WHERE video_id=v;
 IF n<>2 THEN RAISE EXCEPTION 'TEST replay queued duplicates'; END IF;
 BEGIN
  PERFORM public.finalize_media_delivery(j,a,token,a::text||'/'||j::text||'-'||repeat('c',32)||'.mp4','https://storage.example/signed',60,repeat('c',64),10000,true,manifest,'[]');
  RAISE EXCEPTION 'TEST changed SHA accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='TEST changed SHA accepted' THEN RAISE; END IF; END;
 SELECT * INTO q FROM public.claim_media_delivery('youtube','UCtest');
 IF q.id IS NULL THEN RAISE EXCEPTION 'TEST delivery claim missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.claim_media_delivery('youtube','UCtest')) THEN RAISE EXCEPTION 'TEST duplicate delivery claimed'; END IF;
 BEGIN
  PERFORM public.checkpoint_media_delivery(q.id,gen_random_uuid(),'{"phase":"bad"}');RAISE EXCEPTION 'TEST stale fence accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='TEST stale fence accepted' THEN RAISE; END IF; END;
 PERFORM public.checkpoint_media_delivery(q.id,q.claim_token,'{"phase":"youtube_uploading","upload_url":"https://www.googleapis.com/session"}');
 PERFORM public.finish_media_delivery(q.id,q.claim_token,'needs_reconciliation',NULL,'timeout');
 IF EXISTS(SELECT 1 FROM public.claim_media_delivery('youtube','UCtest')) THEN RAISE EXCEPTION 'TEST ambiguous upload retried'; END IF;
 IF NOT public.resume_media_delivery(q.id) THEN RAISE EXCEPTION 'TEST explicit safe session resume failed'; END IF;
 SELECT * INTO q FROM public.claim_media_delivery('youtube','UCtest');
 IF q.checkpoint->>'upload_url' IS NULL THEN RAISE EXCEPTION 'TEST checkpoint lost'; END IF;
 PERFORM public.finish_media_delivery(q.id,q.claim_token,'succeeded','{"id":"youtube-test","url":"https://youtu.be/youtube-test"}',NULL);
 IF (SELECT video_id FROM public.articles WHERE id=a)<>'youtube-test' THEN RAISE EXCEPTION 'TEST YouTube legacy metadata not synced'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.videos WHERE id=v AND platform_posted ? 'youtube') THEN RAISE EXCEPTION 'TEST receipt missing'; END IF;
 -- Lease expiry with a checkpoint requires reconciliation, not a fresh upload.
 SELECT * INTO q FROM public.claim_media_delivery('facebook','123');
 PERFORM public.checkpoint_media_delivery(q.id,q.claim_token,'{"phase":"facebook_initiating"}');
 UPDATE public.video_delivery_outbox SET lease_expires_at=now()-interval '1 minute' WHERE id=q.id;
 PERFORM public.claim_media_delivery('facebook','123');
 IF (SELECT status FROM public.video_delivery_outbox WHERE id=q.id)<>'needs_reconciliation' THEN RAISE EXCEPTION 'TEST expired unsafe side effect requeued'; END IF;
 -- A second article with identical content must not obtain a second reservation.
 INSERT INTO public.articles(id,title_bn,content_bn,status,published_at) VALUES(a2,'দ্বিতীয় পরীক্ষা',repeat('বাংলা সংবাদ ',40),'published',now());
 IF EXISTS(SELECT 1 FROM public.claim_reviewed_video_job(a2)) THEN RAISE EXCEPTION 'TEST unreviewed article claimed'; END IF;
 SELECT job_id,claim_token INTO j,token FROM public.claim_video_generation_job(a2);
 BEGIN
  PERFORM public.reserve_video_story(j,token,repeat('a',64),repeat('b',64),'একই সংবাদ');RAISE EXCEPTION 'TEST duplicate content accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='TEST duplicate content accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.reserve_video_broll(j,token,repeat('9',64),'https://commons.wikimedia.org/wiki/File:Test.webm');RAISE EXCEPTION 'TEST B-roll reuse accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='TEST B-roll reuse accepted' THEN RAISE; END IF; END;
 PERFORM public.reserve_video_story(j,token,repeat('1',64),repeat('2',64),'আলাদা সংবাদ');
 UPDATE public.video_generation_jobs SET status='failed',lease_expires_at=NULL WHERE id=j;
 IF NOT public.renew_media_upload_claim(j,token) THEN RAISE EXCEPTION 'TEST interrupted upload could not be renewed'; END IF;
 BEGIN
  PERFORM public.finalize_media_delivery(j,a2,token,a2::text||'/'||j::text||'-'||repeat('c',32)||'.mp4','https://storage.example/signed',39,repeat('3',64),10000,false,jsonb_build_object('content_key',repeat('1',64),'script_hash',repeat('2',64),'caption_method','groq-whisper'),'[]');RAISE EXCEPTION 'TEST short duration accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='TEST short duration accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.finalize_media_delivery(j,a2,token,a2::text||'/'||j::text||'-'||repeat('c',32)||'.mp4','https://storage.example/signed',60,repeat('3',64),10000,true,jsonb_build_object('content_key',repeat('1',64),'script_hash',repeat('2',64),'caption_method','groq-whisper'),'[]');RAISE EXCEPTION 'TEST unverified publish accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='TEST unverified publish accepted' THEN RAISE; END IF; END;
 UPDATE public.video_generation_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=j;
 renewed=public.renew_render_claim(j,token);
 IF renewed=token THEN RAISE EXCEPTION 'TEST recovery did not rotate expired token'; END IF;
 IF public.fail_video_generation_job(j,token,'stale worker') THEN RAISE EXCEPTION 'TEST old render worker not fenced'; END IF;
 RAISE NOTICE 'PASS: claims, dedup, transactional finalization, replay, metadata, fences, ambiguous outcome and recovery';
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.video_delivery_outbox;RAISE EXCEPTION 'TEST anonymous table read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.claim_media_delivery('youtube','UCtest');RAISE EXCEPTION 'TEST anonymous RPC allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: anonymous permissions denied';
END $$;
ROLLBACK;
