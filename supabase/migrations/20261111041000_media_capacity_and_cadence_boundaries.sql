-- Forward-only media capacity and boundary-aligned Dhaka cadence. No activation.
BEGIN;
CREATE OR REPLACE FUNCTION public.newsroom_due_slot(p_now timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 WITH local AS (SELECT p_now AT TIME ZONE 'Asia/Dhaka' AS t), anchor AS (
 SELECT t, date_trunc('day',t) + CASE WHEN t::time<time '06:00' THEN interval '0 hours' ELSE interval '6 hours' END AS a,
 CASE WHEN t::time<time '06:00' THEN 3600 ELSE 840 END AS seconds FROM local
 ) SELECT (a + floor(extract(epoch FROM (t-a))/seconds)*make_interval(secs=>seconds)) AT TIME ZONE 'Asia/Dhaka' FROM anchor
$$;
REVOKE ALL ON FUNCTION public.newsroom_due_slot(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.newsroom_due_slot(timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.tick_newsroom_14m()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  last_tick timestamptz;
  secret text;
  origin text;
  request_id bigint;
  due_slot timestamptz;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(73920514) THEN
    RETURN NULL;
  END IF;

  due_slot := public.newsroom_due_slot(now());

  SELECT last_requested_at
    INTO last_tick
    FROM public.newsroom_cadence_state
   WHERE id = true
   FOR UPDATE;

  IF last_tick IS NOT NULL AND last_tick >= due_slot THEN
    RETURN NULL;
  END IF;

  SELECT ds.decrypted_secret
    INTO secret
    FROM public.api_vault v
    JOIN vault.decrypted_secrets ds ON ds.id = v.key_encrypted
   WHERE v.service_name = 'NEWSROOM_INGEST_KEY'
     AND v.environment = 'prod'
     AND v.is_active
   LIMIT 1;

  origin := rtrim(public.deployment_setting('SITE_URL'), '/');
  IF length(COALESCE(secret, '')) < 32
     OR origin !~ '^https://[a-zA-Z0-9.-]+(:443)?$' THEN
    RAISE EXCEPTION 'cadence_configuration_missing';
  END IF;

  SELECT net.http_post(
    url := origin || '/api/newsroom/cron-trigger',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  ) INTO request_id;

  IF request_id IS NULL THEN
    RAISE EXCEPTION 'cadence_enqueue_failed';
  END IF;

  UPDATE public.newsroom_cadence_state
     SET last_requested_at = now(),
         last_request_id = request_id
   WHERE id = true;

  -- No catch-up burst: at most the current slot is enqueued.
  -- This is a request receipt, never a claim that an article was published.
  RETURN request_id;
END
$function$;


CREATE OR REPLACE FUNCTION public.claim_reviewed_video_job(p_article_id uuid DEFAULT NULL)
RETURNS TABLE(article_id uuid,job_id uuid,claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chosen uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(73920511);
  -- Count failed attempts too: failed provider calls can still cost money.
  -- Ten successful/pending-complete story assets per Dhaka day; failed attempts
  -- have a separate bounded budget, so one TTS failure does not consume a success slot.
  PERFORM public.recover_expired_video_generation_jobs();
  IF (SELECT count(*) FROM public.video_generation_jobs WHERE created_at >= (date_trunc('day',now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka'))>=30 THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.video_generation_jobs WHERE created_at >= (date_trunc('day',now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka') AND status IN ('completed','needs_review','publishing','processing','queued'))>=10 THEN RETURN; END IF;
  SELECT a.id INTO chosen FROM public.articles a
  WHERE a.status='published' AND length(a.content_bn)>200
    AND public.video_gate_basis(a.id) IS NOT NULL
    AND a.source_published_at BETWEEN now()-interval '24 hours' AND now()+interval '5 minutes'
    AND (p_article_id IS NULL OR a.id=p_article_id)
    AND NOT EXISTS(SELECT 1 FROM public.videos v WHERE v.article_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM public.video_generation_jobs j WHERE j.article_id=a.id AND j.status IN ('queued','processing','needs_review','publishing'))
    AND (SELECT count(*) FROM public.video_generation_jobs j WHERE j.article_id=a.id AND j.created_at>now()-interval '24 hours')<3
  ORDER BY a.published_at DESC NULLS LAST,a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1;
  IF chosen IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.claim_video_generation_job(chosen);
END $$;


REVOKE ALL ON FUNCTION public.claim_reviewed_video_job(uuid),public.tick_newsroom_14m() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reviewed_video_job(uuid),public.tick_newsroom_14m() TO service_role;
COMMIT;
