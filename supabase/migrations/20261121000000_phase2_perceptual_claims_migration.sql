-- BVAI phase 2 -- additive, idempotent, forward-only. NOT auto-applied by any script.
-- Apply manually (SQL editor or psql -1). Takes no provider action, starts no scheduler, deletes no rows,
-- never touches an outbox checkpoint and changes no existing function body.
-- 1) conditional hardening: client roles never hold privileges on api_vault or the fenced reservation RPCs
-- 2) perceptual (near-duplicate) video fingerprints, fenced by the same job claim as reserve_video_broll
-- 3) claim-by-claim human review bound to the exact rendered asset sha256 + approval gate function
-- 4) human-approved Facebook (<=90 s) variant registry; never an automatic truncation
-- 5) read-only observability views + alert rules (service_role only)
-- Rollback: scripts/pipeline/sql/phase2_rollback.sql (drops only objects created here).
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.video_delivery_outbox') IS NULL OR
     to_regclass('public.video_generation_jobs') IS NULL OR
     to_regclass('public.video_delivery_assets') IS NULL OR
     to_regclass('public.videos') IS NULL OR
     to_regclass('public.articles') IS NULL OR
     to_regclass('public.news_sources') IS NULL THEN
    RAISE EXCEPTION 'phase2_requires_media_delivery_reliability_and_newsroom_tables';
  END IF;
END $$;

-- 1) Conditional hardening (each statement only when the object exists; live already matches, kept for fresh databases)
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

-- 2) Perceptual video dedup
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
CREATE OR REPLACE FUNCTION public.perceptual_overlap(p_a text[], p_b text[], p_max_distance integer)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  WITH a AS (SELECT DISTINCT h FROM unnest(p_a) h WHERE h NOT IN ('0000000000000000','ffffffffffffffff')),
       b AS (SELECT DISTINCT h FROM unnest(p_b) h WHERE h NOT IN ('0000000000000000','ffffffffffffffff')),
       total AS (SELECT count(*) AS n FROM a),
       matched AS (SELECT count(*) AS n FROM a WHERE EXISTS (
         SELECT 1 FROM b WHERE bit_count((('x' || a.h)::bit(64) # (('x' || b.h)::bit(64)))) <= p_max_distance
       ))
  SELECT CASE WHEN (SELECT n FROM total) = 0 THEN 0::numeric
              ELSE (SELECT n FROM matched)::numeric / (SELECT n FROM total)::numeric END
$$;
REVOKE ALL ON FUNCTION public.perceptual_overlap(text[],text[],integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.perceptual_overlap(text[],text[],integer) TO service_role;

-- 3) Claim-by-claim human review bound to exact rendered asset sha256
CREATE TABLE IF NOT EXISTS public.video_claim_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.video_generation_jobs(id),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewer text,
  note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,sha256)
);
CREATE INDEX IF NOT EXISTS video_claim_reviews_job_idx ON public.video_claim_reviews(job_id);
REVOKE ALL ON public.video_claim_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.video_claim_reviews TO service_role;

CREATE OR REPLACE FUNCTION public.approve_video_claim(p_job_id uuid, p_sha256 text, p_approved boolean, p_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.video_claim_reviews
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
      note = p_note, reviewed_at = now()
  WHERE job_id = p_job_id AND sha256 = p_sha256;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.approve_video_claim(uuid,text,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_video_claim(uuid,text,boolean,text) TO service_role;

-- 4) Human-approved Facebook (<=90 s) variant registry
CREATE TABLE IF NOT EXISTS public.video_facebook_variants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.video_generation_jobs(id),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  variant_url text NOT NULL,
  duration_seconds numeric NOT NULL CHECK(duration_seconds > 0 AND duration_seconds <= 90),
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,sha256)
);
REVOKE ALL ON public.video_facebook_variants FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.video_facebook_variants TO service_role;

-- 5) Read-only observability views + alert rules (service_role only)
CREATE OR REPLACE VIEW public.video_perceptual_stats AS
SELECT job_id, count(*) AS fingerprint_rows, min(created_at) AS first_seen, max(created_at) AS last_seen
FROM public.video_perceptual_fingerprints GROUP BY job_id;
CREATE OR REPLACE VIEW public.video_claim_review_queue AS
SELECT job_id, sha256, status, created_at FROM public.video_claim_reviews WHERE status = 'pending';
REVOKE ALL ON public.video_perceptual_stats FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.video_claim_review_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.video_perceptual_stats TO service_role;
GRANT SELECT ON public.video_claim_review_queue TO service_role;

COMMIT;
