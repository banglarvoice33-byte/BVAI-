-- Local fixture ONLY. All assertions roll back.
BEGIN;
DO $$
DECLARE n integer;src uuid:=gen_random_uuid();a uuid:=gen_random_uuid();q uuid;token uuid;j uuid;slot timestamptz;
BEGIN
 -- Exact local boundary: 05:59 -> 05:00, 06:00 -> 06:00, 06:13 -> 06:00,
 -- 06:14 -> 06:14, 23:59 -> 23:58, midnight -> midnight.
 IF public.newsroom_due_slot('2026-11-10 23:59:00+00')<>'2026-11-10 23:00:00+00'::timestamptz THEN RAISE EXCEPTION '05:59 boundary'; END IF;
 IF public.newsroom_due_slot('2026-11-11 00:00:00+00')<>'2026-11-11 00:00:00+00'::timestamptz THEN RAISE EXCEPTION '06:00 boundary'; END IF;
 IF public.newsroom_due_slot('2026-11-11 00:13:00+00')<>'2026-11-11 00:00:00+00'::timestamptz THEN RAISE EXCEPTION '06:13 boundary'; END IF;
 IF public.newsroom_due_slot('2026-11-11 00:14:00+00')<>'2026-11-11 00:14:00+00'::timestamptz THEN RAISE EXCEPTION '06:14 boundary'; END IF;
 IF public.newsroom_due_slot('2026-11-11 17:59:00+00')<>'2026-11-11 17:58:00+00'::timestamptz THEN RAISE EXCEPTION '23:59 boundary'; END IF;
 IF public.newsroom_due_slot('2026-11-11 18:00:00+00')<>'2026-11-11 18:00:00+00'::timestamptz THEN RAISE EXCEPTION 'midnight boundary'; END IF;
 SELECT count(DISTINCT public.newsroom_due_slot(t)) INTO n FROM generate_series('2026-11-10 18:00+00'::timestamptz,'2026-11-11 17:59+00'::timestamptz,interval '1 minute') t;
 IF n<>84 THEN RAISE EXCEPTION 'expected 84 daily slots, got %',n; END IF;
 RAISE NOTICE 'PASS Dhaka boundary assertions and exactly 84 daily slots';

 INSERT INTO public.news_sources(id) VALUES(src);
 INSERT INTO public.articles(id,title_bn,content_bn,status,published_at,origin,source_id,source_name,source_url,source_published_at,verification_status)
 VALUES(a,'বিশ্বস্ত সংবাদ',repeat('বাংলা তথ্য ',50),'published',now(),'aggregated',src,'Test source','https://news.example/story',now(),'auto_verified');
 IF public.video_gate_basis(a)<>'trusted_source' THEN RAISE EXCEPTION 'trusted policy failed'; END IF;
 SELECT job_id,claim_token INTO j,token FROM public.claim_reviewed_video_job(a);
 IF j IS NULL THEN RAISE EXCEPTION 'trusted claim missing'; END IF;
 UPDATE public.articles SET origin='manual',field_report_id=gen_random_uuid() WHERE id=a;
 IF public.video_gate_basis(a) IS NOT NULL THEN RAISE EXCEPTION 'reporter bypass'; END IF;
 UPDATE public.articles SET human_verified=true,verification_status='verified' WHERE id=a;
 IF public.video_gate_basis(a)<>'editorial' THEN RAISE EXCEPTION 'approved reporter gate'; END IF;
 RAISE NOTICE 'PASS trusted automation and reporter editorial distinction';
 UPDATE public.articles SET origin='aggregated',field_report_id=NULL,human_verified=false,verification_status='auto_verified' WHERE id=a;
 PERFORM public.reserve_video_story(j,token,repeat('1',64),repeat('2',64),'তথ্য');
 PERFORM public.reserve_video_broll(j,token,repeat('3',64),'https://commons.wikimedia.org/wiki/File:Test.webm');
 PERFORM public.finalize_media_delivery(j,a,token,a::text||'/'||j::text||'-'||repeat('4',32)||'.mp4','https://storage.example/signed',60,repeat('5',64),10000,true,
  jsonb_build_object('content_key',repeat('1',64),'script_hash',repeat('2',64),'caption_method','edge-matched','evidence',jsonb_build_array(jsonb_build_object('role','news_source','sha256',repeat('6',64),'fetched_at',now()))),'[]'::jsonb);
 IF NOT EXISTS(SELECT 1 FROM public.videos WHERE article_id=a AND status='published') THEN RAISE EXCEPTION 'trusted single-evidence finalize failed'; END IF;
 RAISE NOTICE 'PASS trusted single-evidence public finalize transaction';

 INSERT INTO public.social_posts(article_id,platform,status) VALUES(a,'facebook','pending') RETURNING id INTO q;
 SELECT c.claim_token INTO token FROM public.claim_social_posts(ARRAY['facebook'],1,120)c;
 IF token IS NULL THEN RAISE EXCEPTION 'social claim missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.claim_social_posts(ARRAY['facebook'],1,120)) THEN RAISE EXCEPTION 'double claim'; END IF;
 UPDATE public.social_posts SET dispatch_started_at=now(),claimed_at=now()-interval '1 hour' WHERE id=q;
 IF EXISTS(SELECT 1 FROM public.claim_social_posts(ARRAY['facebook'],1,120)) THEN RAISE EXCEPTION 'ambiguous provider request was reissued'; END IF;
 IF EXISTS(SELECT 1 FROM public.social_dispatch_readiness_v2 WHERE is_ready) THEN RAISE EXCEPTION 'unsafe auto enable'; END IF;
 IF has_table_privilege('anon','public.social_posts','SELECT') OR has_function_privilege('anon','public.claim_social_posts(text[],integer,integer)','EXECUTE') THEN RAISE EXCEPTION 'public queue access'; END IF;
 RAISE NOTICE 'PASS social barrier, disabled readiness and anonymous denial';
END $$;
ROLLBACK;
