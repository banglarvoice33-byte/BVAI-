-- Diagnose why video_job_due() is false and provide a controlled force-enqueue for Agnes.
-- Idempotent. Does NOT lower editorial gates for classic finalize_media_delivery.
-- Apply in Supabase SQL editor as postgres / service role after backup.

BEGIN;

CREATE OR REPLACE FUNCTION public.diagnose_video_job_due()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  hr integer := extract(hour from timezone('Asia/Dhaka', now()))::integer;
  day_start timestamptz := date_trunc('day', timezone('Asia/Dhaka', now())) at time zone 'Asia/Dhaka';
  w record;
  last_in_window timestamptz;
  gap interval;
  slot_ok boolean := false;
  window_ok boolean := false;
  spacing_ok boolean := true;
  eligible_count integer := 0;
  reasons text[] := ARRAY[]::text[];
  sample jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    slot_ok := public.video_slot_available(false);
  EXCEPTION WHEN OTHERS THEN
    slot_ok := false;
    reasons := array_append(reasons, 'video_slot_available_error:' || SQLERRM);
  END;
  IF NOT slot_ok THEN
    reasons := array_append(reasons, 'no_slot_available_today_or_quota_exhausted');
  END IF;

  SELECT * INTO w
  FROM public.video_peak_windows
  WHERE enabled AND quota > 0 AND hr >= start_hour AND hr < end_hour
  ORDER BY start_hour
  LIMIT 1;

  IF NOT FOUND THEN
    reasons := array_append(reasons, format('outside_peak_window_dhaka_hour_%s', hr));
  ELSE
    window_ok := true;
    gap := make_interval(secs => floor(((w.end_hour - w.start_hour) * 3600.0 / w.quota) * 0.8)::integer);
    SELECT max(created_at) INTO last_in_window
    FROM public.video_generation_jobs
    WHERE status <> 'failed'
      AND created_at >= day_start + make_interval(hours => w.start_hour)
      AND created_at < day_start + make_interval(hours => w.end_hour);
    IF last_in_window IS NOT NULL AND now() < last_in_window + gap THEN
      spacing_ok := false;
      reasons := array_append(reasons, format('spacing_wait_until_%s', (last_in_window + gap)::text));
    END IF;
  END IF;

  SELECT count(*) INTO eligible_count
  FROM public.articles a
  WHERE a.status = 'published'
    AND length(a.content_bn) > 200
    AND public.video_gate_basis(a.id) IS NOT NULL
    AND coalesce(a.source_published_at, a.published_at) BETWEEN now() - interval '24 hours' AND now() + interval '5 minutes'
    AND NOT EXISTS (SELECT 1 FROM public.videos v WHERE v.article_id = a.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.video_generation_jobs j
      WHERE j.article_id = a.id AND j.status IN ('queued', 'processing', 'needs_review')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.video_generation_jobs j
      WHERE j.article_id = a.id AND j.status = 'failed' AND j.created_at > now() - interval '24 hours'
        AND (j.error_message LIKE 'article_too_short_for_video%' OR j.error_message LIKE 'duplicate_story_or_script%')
    )
    AND (SELECT count(*) FROM public.video_generation_jobs j WHERE j.article_id = a.id AND j.created_at > now() - interval '24 hours') < 3;

  IF eligible_count = 0 THEN
    reasons := array_append(reasons, 'no_eligible_published_article_last_24h_with_gate_basis');
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO sample
  FROM (
    SELECT a.id,
           length(a.content_bn) AS bn_len,
           a.human_verified,
           a.verification_status,
           public.video_gate_basis(a.id) AS gate_basis,
           coalesce(a.source_published_at, a.published_at) AS source_ts,
           EXISTS (SELECT 1 FROM public.videos v WHERE v.article_id = a.id) AS has_video
    FROM public.articles a
    WHERE a.status = 'published'
    ORDER BY coalesce(a.source_published_at, a.published_at) DESC NULLS LAST
    LIMIT 8
  ) x;

  RETURN jsonb_build_object(
    'video_job_due', public.video_job_due(),
    'dhaka_hour', hr,
    'slot_ok', slot_ok,
    'window_ok', window_ok,
    'window_key', w.window_key,
    'spacing_ok', spacing_ok,
    'eligible_article_count', eligible_count,
    'reasons', to_jsonb(reasons),
    'recent_published_sample', sample,
    'checked_at', now()
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.diagnose_video_job_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.diagnose_video_job_due() TO service_role;

CREATE OR REPLACE FUNCTION public.force_enqueue_agnes_job(
  p_article_id uuid,
  p_script text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  a public.articles%ROWTYPE;
  jid uuid;
  script text;
BEGIN
  SELECT * INTO a FROM public.articles WHERE id = p_article_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'article_not_found';
  END IF;
  IF a.status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'article_not_published';
  END IF;
  IF length(coalesce(a.content_bn, '')) < 40 THEN
    RAISE EXCEPTION 'content_bn_too_short';
  END IF;

  script := coalesce(
    nullif(trim(p_script), ''),
    left(coalesce(a.title_bn, '') || '। ' || coalesce(a.content_bn, ''), 1200)
  );

  INSERT INTO public.agnes_video_jobs (article_id, status, payload, script_text)
  VALUES (
    p_article_id,
    'queued',
    jsonb_build_object('script', script, 'source', 'force_enqueue_agnes_job'),
    script
  )
  RETURNING id INTO jid;

  RETURN jid;
END;
$fn$;

REVOKE ALL ON FUNCTION public.force_enqueue_agnes_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.force_enqueue_agnes_job(uuid, text) TO service_role;

COMMIT;
