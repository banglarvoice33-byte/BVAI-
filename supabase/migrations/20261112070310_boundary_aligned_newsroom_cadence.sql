-- The previous "now() < last_tick + 14 min" check drifts to a 15-minute period (observed live: 12:09, 12:24, 12:39, 12:54).
-- Boundary-aligned slots give exactly one run per slot: every 14 min from 06:00 to 23:59 Asia/Dhaka, hourly from 00:00 to 05:59.
CREATE OR REPLACE FUNCTION public.newsroom_due_slot(p_now timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  WITH local AS (SELECT p_now AT TIME ZONE 'Asia/Dhaka' AS t), anchor AS (
    SELECT t, date_trunc('day', t) + CASE WHEN t::time < time '06:00' THEN interval '0 hours' ELSE interval '6 hours' END AS a,
           CASE WHEN t::time < time '06:00' THEN 3600 ELSE 840 END AS seconds FROM local
  ) SELECT (a + floor(extract(epoch FROM (t - a)) / seconds) * make_interval(secs => seconds)) AT TIME ZONE 'Asia/Dhaka' FROM anchor
$$;
REVOKE ALL ON FUNCTION public.newsroom_due_slot(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsroom_due_slot(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.tick_newsroom_14m()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  last_tick timestamptz; secret text; origin text; request_id bigint; due_slot timestamptz;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(73920514) THEN RETURN NULL; END IF;
  due_slot := public.newsroom_due_slot(now());
  SELECT last_requested_at INTO last_tick FROM public.newsroom_cadence_state WHERE id = true FOR UPDATE;
  -- One request per slot; no catch-up burst after an outage.
  IF last_tick IS NOT NULL AND last_tick >= due_slot THEN RETURN NULL; END IF;
  SELECT ds.decrypted_secret INTO secret FROM public.api_vault v JOIN vault.decrypted_secrets ds ON ds.id = v.key_encrypted
   WHERE v.service_name = 'NEWSROOM_INGEST_KEY' AND v.environment = 'prod' AND v.is_active LIMIT 1;
  origin := rtrim(public.deployment_setting('SITE_URL'), '/');
  IF length(COALESCE(secret, '')) < 32 OR origin !~ '^https://[a-zA-Z0-9.-]+(:443)?$' THEN RAISE EXCEPTION 'cadence_configuration_missing'; END IF;
  SELECT net.http_post(
    url := origin || '/api/newsroom/cron-trigger',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb, timeout_milliseconds := 90000) INTO request_id;
  IF request_id IS NULL THEN RAISE EXCEPTION 'cadence_enqueue_failed'; END IF;
  UPDATE public.newsroom_cadence_state SET last_requested_at = now(), last_request_id = request_id WHERE id = true;
  -- A request receipt, never a claim that an article was published.
  RETURN request_id;
END
$function$;
REVOKE ALL ON FUNCTION public.tick_newsroom_14m() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tick_newsroom_14m() TO service_role;
