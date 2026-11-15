-- Run after the media-contract bootstrap and baseline media migrations. Rolls back fixtures.
BEGIN;
DO $$
DECLARE a uuid := gen_random_uuid(); j uuid; token uuid; before_expiry timestamptz;
BEGIN
  INSERT INTO public.articles(id,title_bn,content_bn,status,published_at)
  VALUES(a,'Heartbeat fixture',repeat('test ',80),'published',now());
  SELECT job_id,claim_token INTO j,token FROM public.claim_video_generation_job(a);
  IF j IS NULL THEN RAISE EXCEPTION 'TEST claim missing'; END IF;
  UPDATE public.video_generation_jobs SET lease_expires_at = now() + interval '1 minute' WHERE id=j;
  SELECT lease_expires_at INTO before_expiry FROM public.video_generation_jobs WHERE id=j;
  IF NOT public.heartbeat_reviewed_render(j,token) THEN RAISE EXCEPTION 'TEST live claim refused'; END IF;
  IF (SELECT lease_expires_at <= before_expiry FROM public.video_generation_jobs WHERE id=j) THEN RAISE EXCEPTION 'TEST lease not extended'; END IF;
  IF public.heartbeat_reviewed_render(j,gen_random_uuid()) THEN RAISE EXCEPTION 'TEST wrong token accepted'; END IF;
  IF public.heartbeat_reviewed_render(gen_random_uuid(),token) THEN RAISE EXCEPTION 'TEST unknown job accepted'; END IF;
  UPDATE public.video_generation_jobs SET lease_expires_at = now() - interval '1 minute' WHERE id=j;
  IF public.heartbeat_reviewed_render(j,token) THEN RAISE EXCEPTION 'TEST expired lease resurrected'; END IF;
  UPDATE public.video_generation_jobs SET status='failed',lease_expires_at=now()+interval '1 minute' WHERE id=j;
  IF public.heartbeat_reviewed_render(j,token) THEN RAISE EXCEPTION 'TEST inactive job revived'; END IF;
  IF pg_catalog.has_function_privilege('anon','public.heartbeat_reviewed_render(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'TEST anonymous access'; END IF;
  IF pg_catalog.has_function_privilege('authenticated','public.heartbeat_reviewed_render(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'TEST authenticated access'; END IF;
  IF NOT pg_catalog.has_function_privilege('service_role','public.heartbeat_reviewed_render(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'TEST service role denied'; END IF;
  RAISE NOTICE 'PASS: heartbeat extension, stale token/expired lease fencing, inactive job and role permissions';
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.heartbeat_reviewed_render(gen_random_uuid(),gen_random_uuid());
    RAISE EXCEPTION 'TEST anonymous execution allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
