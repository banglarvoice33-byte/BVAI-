-- Read-only schema contract check. Run before applying ONLY the new media migration.
DO $$
DECLARE missing text[]; coltype text;
BEGIN
  SELECT array_agg(signature) INTO missing FROM unnest(ARRAY[
    'public.claim_video_generation_job(uuid)',
    'public.finalize_video_generation_job(uuid,uuid,uuid,text,text,integer,text,bigint)',
    'public.finalize_website_video(uuid,uuid,uuid,text,text,integer,text,bigint,boolean)',
    'public.fail_video_generation_job(uuid,uuid,text)',
    'public.recover_expired_video_generation_jobs()'
  ]) signature WHERE to_regprocedure(signature) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Missing Nov-9 baseline RPC(s): %',missing; END IF;
  SELECT data_type INTO coltype FROM information_schema.columns WHERE table_schema='public' AND table_name='articles' AND column_name='video_id';
  IF coltype IS DISTINCT FROM 'text' THEN RAISE EXCEPTION 'articles.video_id contract drift: expected external-ID text, got %',coltype; END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='videos' AND column_name='platform_posted' AND data_type='jsonb') THEN RAISE EXCEPTION 'videos.platform_posted jsonb missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='reels' AND public=false) THEN RAISE EXCEPTION 'Private reels bucket missing or public'; END IF;
  IF EXISTS(SELECT 1 FROM public.videos WHERE article_id IS NOT NULL GROUP BY article_id HAVING count(*)>1) THEN RAISE EXCEPTION 'Legacy duplicate videos require audited reconciliation'; END IF;
  RAISE NOTICE 'PASS: November-9 baseline contract present; new additive migration can be staged.';
END $$;
