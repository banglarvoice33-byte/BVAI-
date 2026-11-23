-- Rollback of 20261121000000_phase2_perceptual_claims_metrics.sql. Run ONLY after reverting the code (git apply -R) or
-- setting BVAI_PERCEPTUAL_DEDUP=off. WARNING: drops recorded claim reviews, review checks, perceptual fingerprints and
-- approved Facebook variants (not the master videos, outbox rows or any pre-existing object). Take a backup first.
-- Code that still calls these objects after this script fails closed (publish-review refuses editorial content).
BEGIN;
DROP VIEW IF EXISTS public.media_alerts, public.media_pipeline_summary, public.media_delivery_health, public.media_source_freshness;
DROP FUNCTION IF EXISTS public.register_platform_variant(uuid,text,text,text,bigint,numeric,text,text);
DROP FUNCTION IF EXISTS public.media_review_gate(uuid);
DROP FUNCTION IF EXISTS public.record_review_check(uuid,text,boolean,text,text);
DROP FUNCTION IF EXISTS public.record_claim_review(uuid,text,text,jsonb,text,text);
DROP FUNCTION IF EXISTS public.media_review_claims(uuid);
DROP FUNCTION IF EXISTS public.media_claim_key(text);
DROP FUNCTION IF EXISTS public.reserve_video_perceptual(uuid,uuid,text,text,text[],integer,numeric);
DROP FUNCTION IF EXISTS public.perceptual_overlap(text[],text[],integer);
DROP TABLE IF EXISTS public.video_delivery_variants, public.video_review_checks, public.video_claim_reviews, public.video_perceptual_fingerprints;
COMMIT;
