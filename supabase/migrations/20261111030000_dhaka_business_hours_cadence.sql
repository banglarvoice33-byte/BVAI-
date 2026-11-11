-- Bangladesh-local newsroom cadence:
-- 06:00–23:59 Asia/Dhaka: one ingest request every 14 minutes.
-- 00:00–05:59 Asia/Dhaka: one ingest request every 60 minutes.
-- The pg_cron heartbeat may run every minute; the advisory lock and persisted
-- last_requested_at timestamp enforce a single cadence owner across instances.
-- This migration does NOT bypass article verification or force publication.

BEGIN;

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
  local_clock time;
  required_interval interval;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(73920514) THEN
    RETURN NULL;
  END IF;

  local_clock := timezone('Asia/Dhaka', now())::time;
  required_interval := CASE
    WHEN local_clock >= time '00:00' AND local_clock < time '06:00'
      THEN interval '60 minutes'
    ELSE interval '14 minutes'
  END;

  SELECT last_requested_at
    INTO last_tick
    FROM public.newsroom_cadence_state
   WHERE id = true
   FOR UPDATE;

  IF last_tick IS NOT NULL AND now() < last_tick + required_interval THEN
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

  -- This is a request receipt, never a claim that an article was published.
  RETURN request_id;
END
$function$;

COMMENT ON FUNCTION public.tick_newsroom_14m() IS
  'Dhaka-local cadence: every 14 minutes 06:00-23:59, hourly 00:00-05:59. Trigger receipt only; not a publication guarantee.';

COMMIT;
