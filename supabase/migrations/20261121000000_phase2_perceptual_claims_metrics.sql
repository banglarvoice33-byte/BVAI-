-- BVAI phase 2 — additive, idempotent, forward-only. NOT auto-applied by any script.
-- Apply manually (SQL editor or psql -1). Takes no provider action, starts no scheduler, deletes no rows,
-- never touches an outbox checkpoint and changes no existing function body.
--   1) conditional hardening: client roles never hold privileges on api_vault or the fenced reservation RPCs
--   2) perceptual (near-duplicate) video fingerprints, fenced by the same job claim as reserve_video_broll
--   3) claim-by-claim human review bound to the exact rendered asset sha256 + approval gate function
--   4) human-approved Facebook (<=90 s) variant registry; never an automatic truncation
--   5) read-only observability views + alert rules (service_role only)
-- Rollback: scripts/pipeline/sql/phase2_rollback.sql (drops only objects created here).
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.video_delivery_outbox') IS NULL OR to_regclass('public.video_generation_jobs') IS NULL
     OR to_regclass('public.video_delivery_assets') IS NULL OR to_regclass('public.videos') IS NULL
     OR to_regclass('public.articles') IS NULL OR to_regclass('public.news_sources') IS NULL THEN
    RAISE EXCEPTION 'phase2_requires_media_delivery_reliability_and_newsroom_tables';
  END IF;
END $$;

-- 1) Conditional hardening (each statement only when the object exists; live already matches, kept for fresh databases) ----
DO $$ BEGIN
  IF to_regprocedure('public.reserve_video_broll(uuid,uuid,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.reserve_video_broll(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.reserve_video_broll(uuid,uuid,text,text) TO service_role;
  END IF;
  IF to_regprocedure('public.renew_media_upload_claim(uuid,uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.renew_media_upload_claim(uuid,uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.renew_media_upload_claim(uuid,uuid) TO service_role;
  END IF;
  IF to_regclass('public.api_vault') IS NOT NULL THEN
    REVOKE ALL ON public.api_vault FROM PUBLIC, anon, authenticated;
    GRANT ALL ON public.api_vault TO service_role;
  END IF;
END $$;

-- 2) Perceptual video dedup ------------------------------------------------------------------------------------------
-- One 64-bit difference hash (16 lowercase hex chars) per sampled frame. Hex text avoids JSON/JS 53-bit loss.
CREATE TABLE IF NOT EXISTS public.video_perceptual_fingerprints (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.video_generation_jobs(id),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  source_url text NOT NULL,
  frame_hashes text[] NOT NULL CHECK(cardinality(frame_hashes) BETWEEN 3 AND 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,sha256)
);
CREATE INDEX IF NOT EXISTS video_perceptual_fingerprints_job_idx ON public.video_perceptual_fingerprints(job_id);

-- Fraction of INFORMATIVE frames of p_a that have a frame in p_b within p_max_distance bits.
-- Flat (all-zero / all-one) hashes carry no information and are ignored, so black frames never "match".
CREATE OR REPLACE FUNCTION public.perceptual_overlap(p_a text[],p_b text[],p_max_distance integer)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  WITH a AS (SELECT DISTINCT h FROM unnest(p_a) h WHERE h NOT IN ('0000000000000000','ffffffffffffffff')),
       b AS (SELECT DISTINCT h FROM unnest(p_b) h WHERE h NOT IN ('0000000000000000','ffffffffffffffff'))
  SELECT CASE WHEN (SELECT count(*) FROM a)=0 OR (SELECT count(*) FROM b)=0 THEN 0::numeric
    ELSE (SELECT count(*) FROM a WHERE EXISTS(SELECT 1 FROM b WHERE pg_catalog.bit_count((('x'||a.h)::pg_catalog.bit(64)) # (('x'||b.h)::pg_catalog.bit(64)))<=p_max_distance))::numeric
         / (SELECT count(*) FROM a) END
$$;

CREATE OR REPLACE FUNCTION public.reserve_video_perceptual(p_job_id uuid,p_claim_token uuid,p_sha256 text,p_source_url text,p_frames text[],p_max_distance integer DEFAULT 10,p_min_overlap numeric DEFAULT 0.6)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; informative integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(73920514);
  IF p_max_distance NOT BETWEEN 0 AND 20 OR p_min_overlap NOT BETWEEN 0.3 AND 1 THEN RAISE EXCEPTION 'invalid_perceptual_threshold'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.video_generation_jobs WHERE id=p_job_id AND claim_token=p_claim_token AND status='processing' AND lease_expires_at>now()) THEN RAISE EXCEPTION 'invalid_perceptual_claim'; END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_perceptual_fingerprint'; END IF;
  IF p_frames IS NULL OR cardinality(p_frames) NOT BETWEEN 3 AND 600 OR EXISTS(SELECT 1 FROM unnest(p_frames) f WHERE f !~ '^[0-9a-f]{16}$') THEN RAISE EXCEPTION 'invalid_perceptual_fingerprint'; END IF;
  SELECT count(*) INTO informative FROM (SELECT DISTINCT h FROM unnest(p_frames) h WHERE h NOT IN ('0000000000000000','ffffffffffffffff')) x;
  IF informative<3 THEN RAISE EXCEPTION 'insufficient_visual_information'; END IF;
  IF EXISTS(SELECT 1 FROM public.video_perceptual_fingerprints WHERE job_id=p_job_id AND sha256=p_sha256) THEN RETURN true; END IF;
  -- Same release semantics as exact-hash reservations: a failed/cancelled job that never produced a video frees its clips.
  FOR r IN
    SELECT f.job_id,f.frame_hashes FROM public.video_perceptual_fingerprints f JOIN public.video_generation_jobs j ON j.id=f.job_id
    WHERE f.job_id<>p_job_id AND (j.status NOT IN ('failed','cancelled') OR j.video_id IS NOT NULL)
  LOOP
    IF GREATEST(public.perceptual_overlap(p_frames,r.frame_hashes,p_max_distance),public.perceptual_overlap(r.frame_hashes,p_frames,p_max_distance))>=p_min_overlap THEN
      RAISE EXCEPTION 'perceptual_duplicate';
    END IF;
  END LOOP;
  INSERT INTO public.video_perceptual_fingerprints(job_id,sha256,source_url,frame_hashes) VALUES(p_job_id,p_sha256,left(p_source_url,2000),p_frames);
  RETURN true;
END $$;

-- 3) Claim-by-claim human review, bound to the exact asset ---------------------------------------------------------
-- video_sha256 pins every verdict/checkbox to the rendered file. A re-render (new sha256) silently invalidates old reviews.
CREATE TABLE IF NOT EXISTS public.video_claim_reviews (
  job_id uuid NOT NULL REFERENCES public.video_generation_jobs(id),
  claim_key text NOT NULL CHECK(claim_key ~ '^[a-f0-9]{16}$'),
  video_sha256 text NOT NULL CHECK(video_sha256 ~ '^[a-f0-9]{64}$'),
  claim_text text NOT NULL,
  verdict text NOT NULL CHECK(verdict IN ('verified','disputed','unverified','needs_primary')),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(evidence)='array'),
  note text,
  reviewer text NOT NULL CHECK(length(btrim(reviewer))>0),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,claim_key)
);
CREATE TABLE IF NOT EXISTS public.video_review_checks (
  job_id uuid NOT NULL REFERENCES public.video_generation_jobs(id),
  item text NOT NULL CHECK(item IN ('names','numbers','dates','sources','pronunciation','scene_relevance','captions','audio_level','safe_zone','copyright','disclosure')),
  video_sha256 text NOT NULL CHECK(video_sha256 ~ '^[a-f0-9]{64}$'),
  passed boolean NOT NULL,
  reviewer text NOT NULL CHECK(length(btrim(reviewer))>0),
  note text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,item)
);

-- Stable claim identity: first 16 hex chars of sha256(NFC text, whitespace collapsed). Mirrored in review-claims.mjs.
CREATE OR REPLACE FUNCTION public.media_claim_key(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(pg_catalog.regexp_replace(normalize(p_text,NFC),'\s+',' ','g')),'UTF8')),'hex'),1,16)
$$;

-- Reviewable claims = the source sentences the renderer actually spoke: manifest.production_plan.excerpts (headline + chosen
-- source sentences; the credit line and call-to-action are NOT claims). Older assets fall back to splitting claim_script /
-- production_plan.display_script / display_script into sentences.
CREATE OR REPLACE FUNCTION public.media_review_claims(p_job_id uuid)
RETURNS TABLE(ord integer,claim_key text,claim_text text)
LANGUAGE sql STABLE SET search_path='' AS $$
  WITH a AS (SELECT manifest FROM public.video_delivery_assets WHERE job_id=p_job_id),
  ex AS (
    SELECT o::integer AS ord,x->>'text' AS t
    FROM a, pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(a.manifest#>'{production_plan,excerpts}')='array' THEN a.manifest#>'{production_plan,excerpts}' ELSE '[]'::jsonb END) WITH ORDINALITY e(x,o)
  ),
  fb AS (
    SELECT o::integer AS ord,s AS t
    FROM a, pg_catalog.regexp_split_to_table(COALESCE(a.manifest->>'claim_script',a.manifest#>>'{production_plan,display_script}',a.manifest->>'display_script',''),'(?<=[।!?])\s+') WITH ORDINALITY q(s,o)
    WHERE NOT EXISTS(SELECT 1 FROM ex WHERE pg_catalog.btrim(COALESCE(ex.t,''))<>'')
  ),
  u AS (SELECT ord,pg_catalog.btrim(pg_catalog.regexp_replace(normalize(t,NFC),'\s+',' ','g')) AS t FROM (SELECT * FROM ex UNION ALL SELECT * FROM fb) z WHERE pg_catalog.btrim(COALESCE(t,''))<>''),
  k AS (SELECT DISTINCT ON (public.media_claim_key(t)) ord,public.media_claim_key(t) AS ck,t FROM u ORDER BY public.media_claim_key(t),ord)
  SELECT (row_number() OVER (ORDER BY k.ord))::integer,k.ck,k.t FROM k
$$;

CREATE OR REPLACE FUNCTION public.record_claim_review(p_job_id uuid,p_claim_key text,p_verdict text,p_evidence jsonb,p_note text,p_reviewer text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ev jsonb; independent integer:=0; primary_doc boolean:=false; sha text; ctext text;
BEGIN
  SELECT sha256 INTO sha FROM public.video_delivery_assets WHERE job_id=p_job_id;
  IF sha IS NULL THEN RAISE EXCEPTION 'review_asset_missing'; END IF;
  SELECT c.claim_text INTO ctext FROM public.media_review_claims(p_job_id) c WHERE c.claim_key=p_claim_key;
  IF ctext IS NULL THEN RAISE EXCEPTION 'unknown_claim_for_job'; END IF;
  IF COALESCE(p_evidence,'[]'::jsonb)='null'::jsonb THEN p_evidence:='[]'::jsonb; END IF;
  IF jsonb_typeof(p_evidence)<>'array' THEN RAISE EXCEPTION 'evidence_must_be_array'; END IF;
  FOR ev IN SELECT * FROM jsonb_array_elements(p_evidence) LOOP
    IF COALESCE(ev->>'url','')!~'^https://[^/ ]+' THEN RAISE EXCEPTION 'evidence_url_must_be_https'; END IF;
    IF ev->>'role' IS NULL OR ev->>'role' NOT IN ('news_source','primary_document','official_statement') THEN RAISE EXCEPTION 'invalid_evidence_role'; END IF;
    IF ev->>'role' IN ('primary_document','official_statement') THEN primary_doc:=true; END IF;
    IF ev->>'role'='news_source' AND ev->>'independent_confirmed'='true' THEN independent:=independent+1; END IF;
  END LOOP;
  -- 'verified' is an editor attestation. Distinct domains never prove independence: the reviewer must say so per source.
  IF p_verdict='verified' AND NOT (primary_doc OR independent>=2) THEN
    RAISE EXCEPTION 'verified_requires_primary_document_or_two_independent_confirmed_sources';
  END IF;
  INSERT INTO public.video_claim_reviews(job_id,claim_key,video_sha256,claim_text,verdict,evidence,note,reviewer)
  VALUES(p_job_id,p_claim_key,sha,ctext,p_verdict,p_evidence,left(p_note,2000),p_reviewer)
  ON CONFLICT(job_id,claim_key) DO UPDATE SET video_sha256=EXCLUDED.video_sha256,claim_text=EXCLUDED.claim_text,verdict=EXCLUDED.verdict,evidence=EXCLUDED.evidence,note=EXCLUDED.note,reviewer=EXCLUDED.reviewer,reviewed_at=now();
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.record_review_check(p_job_id uuid,p_item text,p_passed boolean,p_reviewer text,p_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sha text;
BEGIN
  SELECT sha256 INTO sha FROM public.video_delivery_assets WHERE job_id=p_job_id;
  IF sha IS NULL THEN RAISE EXCEPTION 'review_asset_missing'; END IF;
  INSERT INTO public.video_review_checks(job_id,item,video_sha256,passed,reviewer,note) VALUES(p_job_id,p_item,sha,p_passed,p_reviewer,left(p_note,1000))
  ON CONFLICT(job_id,item) DO UPDATE SET video_sha256=EXCLUDED.video_sha256,passed=EXCLUDED.passed,reviewer=EXCLUDED.reviewer,note=EXCLUDED.note,checked_at=now();
  RETURN true;
END $$;

-- Approval gate. Never auto-approves: every spoken sentence needs a human 'verified' verdict and every checklist item a
-- tick, both recorded against the CURRENT asset sha256. Callers (publish-review.mjs) must refuse unless ok=true.
CREATE OR REPLACE FUNCTION public.media_review_gate(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE blockers jsonb:='[]'::jsonb; n integer; chk text; sha text;
BEGIN
  SELECT sha256 INTO sha FROM public.video_delivery_assets WHERE job_id=p_job_id;
  IF sha IS NULL THEN RETURN jsonb_build_object('ok',false,'claims',0,'blockers',jsonb_build_array(jsonb_build_object('code','review_asset_missing'))); END IF;
  SELECT count(*) INTO n FROM public.media_review_claims(p_job_id);
  IF n=0 THEN RETURN jsonb_build_object('ok',false,'claims',0,'blockers',jsonb_build_array(jsonb_build_object('code','no_reviewable_claims_in_manifest'))); END IF;
  SELECT blockers||COALESCE(jsonb_agg(jsonb_build_object('code',CASE WHEN r.verdict IS NULL THEN 'claim_not_reviewed' WHEN r.verdict='disputed' THEN 'claim_disputed' ELSE 'claim_not_verified' END,'claim_key',c.claim_key,'verdict',r.verdict) ORDER BY c.ord),'[]'::jsonb)
    INTO blockers FROM public.media_review_claims(p_job_id) c LEFT JOIN public.video_claim_reviews r ON r.job_id=p_job_id AND r.claim_key=c.claim_key AND r.video_sha256=sha
   WHERE r.verdict IS DISTINCT FROM 'verified';
  FOREACH chk IN ARRAY ARRAY['names','numbers','dates','sources','pronunciation','scene_relevance','captions','audio_level','safe_zone','copyright','disclosure'] LOOP
    IF NOT EXISTS(SELECT 1 FROM public.video_review_checks k WHERE k.job_id=p_job_id AND k.item=chk AND k.passed AND k.video_sha256=sha) THEN
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','checklist_item_not_passed','item',chk));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',jsonb_array_length(blockers)=0,'claims',n,'video_sha256',sha,'blockers',blockers);
END $$;

-- 4) Human-approved platform variants (e.g. Facebook <=90 s cut) ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.video_delivery_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id),
  platform text NOT NULL CHECK(platform IN ('facebook')),
  storage_path text NOT NULL CHECK(storage_path ~ '^variants/[A-Za-z0-9._/-]+\.mp4$' AND storage_path !~ '\.\.'),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK(size_bytes>0),
  duration_sec numeric(7,3) NOT NULL CHECK(duration_sec BETWEEN 3 AND 90),
  approved_by text NOT NULL CHECK(length(btrim(approved_by))>0),
  approval_note text,
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_id,platform),
  CHECK(sha256<>source_sha256)
);
CREATE OR REPLACE FUNCTION public.register_platform_variant(p_video_id uuid,p_platform text,p_path text,p_sha256 text,p_size bigint,p_duration numeric,p_approved_by text,p_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE master text; requeued integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(73920515);
  SELECT sha256 INTO master FROM public.video_delivery_assets WHERE video_id=p_video_id;
  IF master IS NULL THEN RAISE EXCEPTION 'master_asset_missing'; END IF;
  INSERT INTO public.video_delivery_variants(video_id,platform,storage_path,sha256,source_sha256,size_bytes,duration_sec,approved_by,approval_note)
  VALUES(p_video_id,p_platform,p_path,p_sha256,master,p_size,p_duration,p_approved_by,left(p_note,1000));
  -- Re-queue ONLY a row that dead-lettered on the duration gate with an EMPTY checkpoint (no provider identity exists to lose).
  UPDATE public.video_delivery_outbox SET status='retrying',next_attempt_at=now(),last_error=NULL,updated_at=now()
   WHERE video_id=p_video_id AND platform=p_platform AND status='dead_letter' AND checkpoint='{}'::jsonb AND last_error ILIKE '%separate approved edit%';
  GET DIAGNOSTICS requeued=ROW_COUNT;
  RETURN requeued>0;
END $$;

-- 5) Observability: read-only views over existing tables --------------------------------------------------------------
CREATE OR REPLACE VIEW public.media_source_freshness WITH (security_invoker=true) AS
SELECT s.name AS source_name,s.enabled,s.kill_switch,s.interval_minutes,s.consecutive_failures,
  s.last_probe_at,s.last_probe_status,s.last_probe_http_status,s.last_probe_items,left(s.last_probe_error,200) AS last_probe_error,
  (SELECT max(q.created_at) FROM public.news_ingest_queue q WHERE q.source_name=s.name) AS last_item_queued_at,
  (SELECT max(a.published_at) FROM public.articles a WHERE a.source_name=s.name AND a.status='published') AS last_article_published_at,
  round(EXTRACT(epoch FROM now()-s.last_probe_at)/60)::integer AS probe_age_minutes,
  (s.enabled AND NOT s.kill_switch AND (s.last_probe_at IS NULL OR s.last_probe_at<now()-GREATEST(3*s.interval_minutes,180)*interval '1 minute' OR s.consecutive_failures>=3)) AS stale
FROM public.news_sources s;

CREATE OR REPLACE VIEW public.media_delivery_health WITH (security_invoker=true) AS
SELECT o.platform,
  count(*) FILTER (WHERE o.status='queued') AS queued,
  count(*) FILTER (WHERE o.status='processing') AS processing,
  count(*) FILTER (WHERE o.status='retrying') AS retrying,
  count(*) FILTER (WHERE o.status='needs_reconciliation') AS needs_reconciliation,
  count(*) FILTER (WHERE o.status='dead_letter') AS dead_letter,
  count(*) FILTER (WHERE o.status='succeeded') AS succeeded,
  count(*) FILTER (WHERE o.status='succeeded' AND o.result->>'verified_at' IS NOT NULL AND o.result->>'id' IS NOT NULL) AS verified_total,
  count(*) FILTER (WHERE o.status='succeeded' AND o.result->>'verified_at' IS NOT NULL AND o.updated_at>now()-interval '24 hours') AS verified_24h,
  round((max(EXTRACT(epoch FROM now()-o.created_at)) FILTER (WHERE o.status IN ('queued','retrying','processing')))/60)::integer AS oldest_pending_minutes,
  round((max(EXTRACT(epoch FROM now()-o.updated_at)) FILTER (WHERE o.status='needs_reconciliation'))/60)::integer AS oldest_reconciling_minutes
FROM public.video_delivery_outbox o GROUP BY o.platform;

CREATE OR REPLACE VIEW public.media_pipeline_summary WITH (security_invoker=true) AS
SELECT
  (SELECT max(completed_at) FROM public.news_pipeline_runs WHERE status='success' AND stage IN ('cron','collector','pipeline')) AS last_successful_ingestion_at,
  (SELECT count(*) FROM public.news_pipeline_runs WHERE created_at>now()-interval '24 hours' AND status='success') AS ingestion_runs_ok_24h,
  (SELECT count(*) FROM public.news_pipeline_runs WHERE created_at>now()-interval '24 hours' AND status IN ('failed','partial')) AS ingestion_runs_bad_24h,
  (SELECT count(*) FROM public.news_ingest_queue WHERE status='skipped' AND updated_at>now()-interval '24 hours') AS stories_skipped_24h,
  (SELECT count(*) FROM public.news_ingest_queue WHERE status='skipped' AND last_error='duplicate_source' AND updated_at>now()-interval '24 hours') AS stories_duplicate_24h,
  (SELECT max(published_at) FROM public.articles WHERE status='published') AS last_article_published_at,
  (SELECT count(*) FROM public.articles WHERE status='published' AND published_at>now()-interval '24 hours') AS articles_published_24h,
  (SELECT count(*) FROM public.video_generation_jobs WHERE created_at>now()-interval '24 hours') AS video_jobs_24h,
  (SELECT count(*) FROM public.video_generation_jobs WHERE status='failed' AND updated_at>now()-interval '24 hours') AS video_jobs_failed_24h,
  (SELECT count(*) FROM public.video_generation_jobs WHERE status IN ('completed','needs_review') AND updated_at>now()-interval '24 hours') AS video_jobs_rendered_24h,
  (SELECT count(*) FROM public.video_generation_jobs WHERE status='failed' AND updated_at>now()-interval '24 hours' AND error_message ~* '(caption|subtitle|\.ass|karaoke|vtt|whisper)') AS caption_failures_24h,
  (SELECT count(*) FROM public.video_generation_jobs WHERE status='failed' AND updated_at>now()-interval '24 hours' AND error_message ~* '(tts|voice|synthes)') AS tts_failures_24h,
  (SELECT count(*) FROM public.video_generation_jobs WHERE status='failed' AND updated_at>now()-interval '24 hours' AND error_message ~* '(render|ffmpeg|loudness|audio|encode|decode)') AS render_failures_24h,
  (SELECT count(*) FROM public.video_generation_jobs WHERE status='failed' AND updated_at>now()-interval '24 hours' AND error_message ~* '(duplicate|already used|already reserved|perceptual)') AS video_duplicate_rejections_24h,
  (SELECT count(*) FROM public.ai_gateway_usage_events WHERE created_at>now()-interval '24 hours') AS ai_requests_24h,
  (SELECT count(*) FROM public.ai_gateway_usage_events WHERE created_at>now()-interval '24 hours' AND outcome<>'success') AS ai_failures_24h,
  (SELECT COALESCE(sum(input_chars+output_chars),0) FROM public.ai_gateway_usage_events WHERE created_at>now()-interval '24 hours') AS ai_chars_24h,
  (SELECT COALESCE(sum(chars_used),0) FROM public.tts_usage WHERE month=to_char(now(),'YYYY-MM')) AS tts_chars_this_month;

CREATE OR REPLACE VIEW public.media_alerts WITH (security_invoker=true) AS
SELECT 'critical'::text AS severity,'ingestion_stale'::text AS code,'news_pipeline'::text AS subject,
  'No successful ingestion run in 45 minutes (last: '||COALESCE(to_char(m.last_successful_ingestion_at,'YYYY-MM-DD HH24:MI "UTC"'),'never')||')' AS detail
  FROM public.media_pipeline_summary m WHERE m.last_successful_ingestion_at IS NULL OR m.last_successful_ingestion_at<now()-interval '45 minutes'
UNION ALL SELECT 'warning','no_articles_published','articles','No article published in the last 3 hours'
  FROM public.media_pipeline_summary m WHERE m.last_article_published_at IS NULL OR m.last_article_published_at<now()-interval '3 hours'
UNION ALL SELECT 'warning','source_stale',f.source_name,'Feed probe older than limit or >=3 consecutive failures'
  FROM public.media_source_freshness f WHERE f.stale
UNION ALL SELECT 'warning','video_jobs_failed','video_generation_jobs',m.video_jobs_failed_24h||' failed video job(s) in 24h (captions '||m.caption_failures_24h||', tts '||m.tts_failures_24h||', render '||m.render_failures_24h||')'
  FROM public.media_pipeline_summary m WHERE m.video_jobs_failed_24h>=3
UNION ALL SELECT 'warning','no_video_rendered_24h','video_generation_jobs','No video rendered in 24h while '||m.articles_published_24h||' articles were published'
  FROM public.media_pipeline_summary m WHERE m.video_jobs_rendered_24h=0 AND m.articles_published_24h>=10
UNION ALL SELECT 'warning','ai_gateway_errors','ai_gateway',m.ai_failures_24h||' of '||m.ai_requests_24h||' AI requests failed in 24h'
  FROM public.media_pipeline_summary m WHERE m.ai_requests_24h>=10 AND m.ai_failures_24h*2>m.ai_requests_24h
UNION ALL SELECT 'critical','outbox_overdue',o.platform,count(*)||' delivery job(s) overdue by >30 minutes'
  FROM public.video_delivery_outbox o WHERE o.status IN ('queued','retrying') AND o.next_attempt_at<now()-interval '30 minutes' GROUP BY o.platform
UNION ALL SELECT 'critical','needs_reconciliation',o.platform,count(*)||' ambiguous delivery job(s); oldest '||round(max(EXTRACT(epoch FROM now()-o.updated_at))/3600)||'h — verify provider inventory, never re-upload'
  FROM public.video_delivery_outbox o WHERE o.status='needs_reconciliation' AND o.updated_at<now()-interval '2 hours' GROUP BY o.platform
UNION ALL SELECT 'warning','dead_letter',o.platform,count(*)||' dead-lettered job(s) in 24h'
  FROM public.video_delivery_outbox o WHERE o.status='dead_letter' AND o.updated_at>now()-interval '24 hours' GROUP BY o.platform
UNION ALL SELECT 'warning','no_verified_publication_24h',h.platform,'Jobs exist but no independently verified publication in 24h'
  FROM public.media_delivery_health h WHERE h.verified_24h=0 AND (h.queued+h.processing+h.retrying+h.needs_reconciliation+h.dead_letter)>0;

-- All new objects are service-only (RLS + no client privileges).
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['video_perceptual_fingerprints','video_claim_reviews','video_review_checks','video_delivery_variants'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
    EXECUTE format('DROP POLICY IF EXISTS service_only ON public.%I',t);
    EXECUTE format('CREATE POLICY service_only ON public.%I FOR ALL TO service_role USING(true) WITH CHECK(true)',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['media_source_freshness','media_delivery_health','media_pipeline_summary','media_alerts'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
  END LOOP;
END $$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
           AND p.proname IN ('perceptual_overlap','reserve_video_perceptual','media_claim_key','media_review_claims','record_claim_review','record_review_check','media_review_gate','register_platform_variant') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;
COMMIT;
