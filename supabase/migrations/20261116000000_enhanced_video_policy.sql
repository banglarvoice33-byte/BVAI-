-- Policy v2. Replayable on the supplied schema; test on a hosted staging clone before production.
-- No schedules enabled, no existing asset published, no source registry entry auto-approved.
BEGIN;
CREATE TABLE IF NOT EXISTS public.video_pipeline_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_id uuid REFERENCES public.video_generation_jobs(id) ON DELETE SET NULL,
 article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
 event_type text NOT NULL CHECK(length(event_type) BETWEEN 1 AND 80),
 actor_id uuid, details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_pipeline_events_time_idx ON public.video_pipeline_events(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS video_pipeline_publication_event_once ON public.video_pipeline_events(job_id,(details->>'sha256')) WHERE event_type='video_published';
ALTER TABLE public.video_pipeline_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_pipeline_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.video_pipeline_events TO authenticated,service_role;
GRANT INSERT ON public.video_pipeline_events TO service_role;
GRANT USAGE ON SEQUENCE public.video_pipeline_events_id_seq TO service_role;
DROP POLICY IF EXISTS editor_read_pipeline_events ON public.video_pipeline_events;
CREATE POLICY editor_read_pipeline_events ON public.video_pipeline_events FOR SELECT TO authenticated
 USING(public.current_app_role()::text IN ('desk_editor','chief_editor','admin'));

CREATE OR REPLACE FUNCTION public.video_gate_basis(p_article_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE
 WHEN a.id IS NULL OR a.status IS DISTINCT FROM 'published' THEN NULL
 WHEN a.field_report_id IS NOT NULL OR a.origin IS DISTINCT FROM 'aggregated' THEN
   CASE WHEN a.human_verified IS TRUE AND a.verification_status='verified' THEN 'editorial' ELSE NULL END
 WHEN s.id IS NOT NULL AND s.enabled IS TRUE AND s.kill_switch IS NOT TRUE
   AND nullif(btrim(a.source_name),'') IS NOT NULL AND a.source_url ~* '^https?://[^ ]+$'
   AND a.verification_status IN ('auto_verified','verified') AND a.source_published_at IS NOT NULL THEN 'trusted_source'
 ELSE NULL END
 FROM (SELECT 1) x LEFT JOIN public.articles a ON a.id=p_article_id
 LEFT JOIN public.news_sources s ON s.id=a.source_id
$$;
REVOKE ALL ON FUNCTION public.video_gate_basis(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.video_gate_basis(uuid) TO service_role;

-- Human session produces an auditable editorial authorization. Service runners cannot call it.
CREATE OR REPLACE FUNCTION public.approve_reporter_article(p_article_id uuid,p_note text DEFAULT '')
RETURNS TABLE(id uuid,status text,published_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR COALESCE(public.current_app_role()::text,'') NOT IN ('desk_editor','chief_editor','admin') THEN RAISE EXCEPTION 'authenticated_editor_required'; END IF;
 RETURN QUERY UPDATE public.articles a SET status='published',editorial_status='approved',verification_status='verified',
 human_verified=true,workflow_status='published',review_reason=NULL,published_at=now(),updated_at=now()
 WHERE a.id=p_article_id AND a.status='pending' RETURNING a.id,a.status::text,a.published_at;
 IF FOUND THEN INSERT INTO public.video_pipeline_events(article_id,event_type,actor_id,details)
 VALUES(p_article_id,'article_editor_approved',actor,jsonb_build_object('note',left(COALESCE(p_note,''),4000))); END IF;
END $$;
REVOKE ALL ON FUNCTION public.approve_reporter_article(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.approve_reporter_article(uuid,text) TO authenticated;

-- Preserve the old stricter review for legacy clients without forcing it on the new newsroom policy.
DO $$ BEGIN
 IF to_regprocedure('public.record_video_quality_review_v1(uuid,jsonb)') IS NULL
   AND to_regprocedure('public.record_video_quality_review(uuid,jsonb)') IS NOT NULL THEN
  ALTER FUNCTION public.record_video_quality_review(uuid,jsonb) RENAME TO record_video_quality_review_v1;
 END IF;
END $$;
DO $$ BEGIN
  IF to_regprocedure('public.record_video_quality_review_v1(uuid,jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.record_video_quality_review_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.record_video_quality_review(p_job_id uuid,p_review jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); asset public.video_delivery_assets%ROWTYPE; gate text;
BEGIN
 IF actor IS NULL OR COALESCE(public.current_app_role()::text,'') NOT IN ('desk_editor','chief_editor','admin') THEN RAISE EXCEPTION 'authenticated_editor_required'; END IF;
 IF p_review->>'version'='1' THEN RETURN public.record_video_quality_review_v1(p_job_id,p_review); END IF;
 SELECT * INTO asset FROM public.video_delivery_assets WHERE job_id=p_job_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'private_review_asset_required'; END IF;
 IF p_review IS NULL OR p_review->>'version' IS DISTINCT FROM '2'
  OR p_review->>'reviewer_id' IS DISTINCT FROM actor::text
  OR p_review->>'video_sha256' IS DISTINCT FROM asset.sha256
  OR p_review->>'script_sha256' IS DISTINCT FROM asset.manifest->>'spoken_script_hash'
  OR asset.manifest->>'spoken_script_hash' IS NULL
  OR p_review->>'reviewed_at' IS NULL
  OR (p_review->>'reviewed_at')::timestamptz>now()+interval '1 minute'
  OR (p_review->>'reviewed_at')::timestamptz<now()-interval '1 hour'
  THEN RAISE EXCEPTION 'asset_bound_fresh_review_required'; END IF;
 IF p_review->'editorial_authorized' IS DISTINCT FROM 'true'::jsonb
   OR length(btrim(COALESCE(p_review->>'editorial_note',''))) NOT BETWEEN 10 AND 4000
   OR p_review ? 'facebook_edit' THEN RAISE EXCEPTION 'explicit_editorial_authorization_required'; END IF;
 FOREACH gate IN ARRAY ARRAY['names_numbers_dates','pronunciation','scene_relevance','caption_spelling','safe_zones','rights','human_perceptual_qc'] LOOP
  IF p_review->'qc'->gate IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'perceptual_qc_required'; END IF;
 END LOOP;
 IF p_review->>'duration_sec' IS NULL OR (p_review->>'duration_sec')::numeric NOT BETWEEN 40 AND 120
 OR asset.manifest->>'render_duration' IS NULL
 OR abs((p_review->>'duration_sec')::numeric-(asset.manifest->>'render_duration')::numeric)>0.5 THEN RAISE EXCEPTION 'review_duration_mismatch'; END IF;
 INSERT INTO public.video_quality_approvals(job_id,video_sha256,script_sha256,reviewer_id,review,reviewed_at,expires_at)
 VALUES(p_job_id,asset.sha256,asset.manifest->>'spoken_script_hash',actor,p_review,now(),now()+interval '24 hours')
 ON CONFLICT(job_id) DO UPDATE SET video_sha256=EXCLUDED.video_sha256,script_sha256=EXCLUDED.script_sha256,
 reviewer_id=EXCLUDED.reviewer_id,review=EXCLUDED.review,reviewed_at=EXCLUDED.reviewed_at,expires_at=EXCLUDED.expires_at;
 INSERT INTO public.video_pipeline_events(job_id,event_type,actor_id) VALUES(p_job_id,'video_editor_approved',actor);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_video_quality_review(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_video_quality_review(uuid,jsonb) TO authenticated;

-- Single authoritative check, usable before publication and by deferred integrity triggers.
CREATE OR REPLACE FUNCTION public.assert_video_publication(p_video_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE asset public.video_delivery_assets%ROWTYPE; a public.articles%ROWTYPE; report jsonb; basis text; gate text;
BEGIN
 SELECT d.* INTO asset FROM public.video_delivery_assets d WHERE d.video_id=p_video_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'asset_bound_technical_report_required'; END IF;
 SELECT ar.* INTO a FROM public.articles ar JOIN public.videos v ON v.article_id=ar.id WHERE v.id=p_video_id;
 basis:=public.video_gate_basis(a.id);
 IF basis IS NULL THEN RAISE EXCEPTION 'editorial_authorization_required'; END IF;
 report:=asset.manifest->'technical_qc';
 IF report IS NULL OR report->>'version' IS DISTINCT FROM '1' OR report->>'policy_version' IS DISTINCT FROM '2026-11-16.v2'
 OR report->>'video_sha256' IS DISTINCT FROM asset.sha256
 OR report->>'script_sha256' IS DISTINCT FROM asset.manifest->>'spoken_script_hash'
 OR COALESCE(asset.manifest->>'spoken_script_hash','') !~ '^[a-f0-9]{64}$'
 OR report->>'inspected_at' IS NULL OR (report->>'inspected_at')::timestamptz<now()-interval '24 hours'
 OR (report->>'inspected_at')::timestamptz>now()+interval '1 minute' THEN RAISE EXCEPTION 'asset_bound_technical_report_required'; END IF;
 FOREACH gate IN ARRAY ARRAY['master','decode','loudness','captions','rights','source_credit','script_binding'] LOOP
  IF report->'checks'->gate IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'technical_check_required: %',gate; END IF;
 END LOOP;
 IF report->'measured'->>'integrated_lufs' IS NULL OR NOT ((report->'measured'->>'integrated_lufs')::numeric BETWEEN -16 AND -12)
 OR report->'measured'->>'true_peak_dbtp' IS NULL OR NOT ((report->'measured'->>'true_peak_dbtp')::numeric<=-1)
 OR report->'measured'->>'duration_sec' IS NULL OR NOT ((report->'measured'->>'duration_sec')::numeric BETWEEN 40 AND 120)
 THEN RAISE EXCEPTION 'technical_measurements_invalid'; END IF;
 IF basis='editorial' THEN
  IF NOT EXISTS(SELECT 1 FROM public.video_quality_approvals q WHERE q.job_id=asset.job_id AND q.video_sha256=asset.sha256
   AND q.script_sha256=asset.manifest->>'spoken_script_hash' AND q.expires_at>now()) THEN RAISE EXCEPTION 'fresh_asset_bound_human_approval_required'; END IF;
 ELSE
  -- Existing published international-source story: no new multi-source truth hurdle.
  IF a.source_published_at<now()-interval '24 hours' OR a.source_published_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'primary_source_stale'; END IF;
  IF jsonb_typeof(asset.manifest->'evidence') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'credited_source_evidence_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(asset.manifest->'evidence') e WHERE e->>'role'='news_source'
   AND e->>'url'=a.source_url AND e->>'sha256' ~ '^[a-f0-9]{64}$' AND e->>'fetched_at' IS NOT NULL
   AND (e->>'fetched_at')::timestamptz BETWEEN now()-interval '24 hours' AND now()+interval '1 minute')
  THEN RAISE EXCEPTION 'credited_source_evidence_required'; END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_video_publication(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_video_publication(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.require_video_quality_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE vid uuid;
BEGIN
 -- Receipt/description updates of an already-published row are not a new publication.
 -- Otherwise expiring approvals could prevent reconciliation of a successful provider call.
 IF TG_TABLE_NAME='videos' AND TG_OP='UPDATE' THEN
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.article_id IS NOT DISTINCT FROM OLD.article_id THEN RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME='video_delivery_assets' THEN
  IF TG_OP='DELETE' THEN vid:=OLD.video_id; ELSE vid:=NEW.video_id; END IF;
 ELSE
  vid:=NEW.id;
 END IF;
 -- Read current committed-in-transaction state, not an intermediate NEW status.
 IF EXISTS(SELECT 1 FROM public.videos WHERE id=vid AND status='published') THEN PERFORM public.assert_video_publication(vid); END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_video_quality_approval ON public.videos;
CREATE CONSTRAINT TRIGGER enforce_video_quality_approval AFTER INSERT OR UPDATE ON public.videos
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_video_quality_approval();
DROP TRIGGER IF EXISTS enforce_video_asset_approval ON public.video_delivery_assets;
CREATE CONSTRAINT TRIGGER enforce_video_asset_approval AFTER INSERT OR UPDATE OR DELETE ON public.video_delivery_assets
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_video_quality_approval();

-- Wrap the existing reservation, lease-fencing and immutable-storage finalizer.
-- Private staging FIRST fixes the old before-trigger/asset-insert ordering problem.
DO $$ BEGIN
 IF to_regprocedure('public.finalize_media_delivery_v1(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb)') IS NULL THEN
  ALTER FUNCTION public.finalize_media_delivery(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb) RENAME TO finalize_media_delivery_v1;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.finalize_media_delivery_v1(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.finalize_media_delivery(p_job_id uuid,p_article_id uuid,p_claim_token uuid,p_path text,p_signed_url text,
 p_duration_sec integer,p_sha256 text,p_size_bytes bigint,p_publish boolean,p_manifest jsonb,p_targets jsonb DEFAULT '[]'::jsonb)
RETURNS TABLE(video_id uuid,job_status text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE vid uuid; state text; target jsonb;
BEGIN
 IF p_publish IS NULL OR p_targets IS NULL OR jsonb_typeof(p_targets) IS DISTINCT FROM 'array' OR jsonb_array_length(p_targets)>4 THEN RAISE EXCEPTION 'invalid_delivery_targets'; END IF;
 IF NOT p_publish AND jsonb_array_length(p_targets)>0 THEN RAISE EXCEPTION 'review_cannot_distribute'; END IF;
 FOR target IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
  IF COALESCE(target->>'platform','') NOT IN ('youtube','facebook','instagram','tiktok') OR length(btrim(COALESCE(target->>'account_id',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_delivery_target'; END IF;
 END LOOP;
 SELECT f.video_id,f.job_status INTO vid,state FROM public.finalize_media_delivery_v1(p_job_id,p_article_id,p_claim_token,p_path,p_signed_url,p_duration_sec,p_sha256,p_size_bytes,false,p_manifest,'[]'::jsonb) f;
 IF p_publish THEN
  PERFORM public.assert_video_publication(vid);
  UPDATE public.videos SET status='published',updated_at=now() WHERE id=vid;
  UPDATE public.video_generation_jobs SET status='completed',lease_expires_at=NULL,updated_at=now() WHERE id=p_job_id;
  UPDATE public.articles SET video_generated=true,video_generated_at=COALESCE(video_generated_at,now()),updated_at=now() WHERE id=p_article_id;
  FOR target IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
   INSERT INTO public.video_delivery_outbox(video_id,platform,account_id) VALUES(vid,target->>'platform',target->>'account_id')
   ON CONFLICT ON CONSTRAINT video_delivery_outbox_video_id_platform_account_id_key DO NOTHING;
  END LOOP;
  INSERT INTO public.video_pipeline_events(job_id,article_id,event_type,details)
   VALUES(p_job_id,p_article_id,'video_published',jsonb_build_object('basis',public.video_gate_basis(p_article_id),'sha256',p_sha256)) ON CONFLICT DO NOTHING;
  state:='completed';
 END IF;
 RETURN QUERY SELECT vid,state;
END $$;
REVOKE ALL ON FUNCTION public.finalize_media_delivery(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_media_delivery(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb) TO service_role;

-- Extend original reporter guard to manual/original items, content edits and media changes.
CREATE OR REPLACE FUNCTION public.articles_field_report_publish_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.field_report_id IS NOT NULL OR OLD.origin IS DISTINCT FROM 'aggregated')
 AND (auth.uid() IS NULL OR COALESCE(public.current_app_role()::text,'') NOT IN ('desk_editor','chief_editor','admin')) THEN
  NEW.field_report_id:=OLD.field_report_id; NEW.origin:=OLD.origin;
 END IF;
 IF (NEW.field_report_id IS NOT NULL OR NEW.origin IS DISTINCT FROM 'aggregated') THEN
  IF NEW.human_verified IS TRUE AND (TG_OP='INSERT' OR OLD.human_verified IS NOT TRUE)
  AND (auth.uid() IS NULL OR COALESCE(public.current_app_role()::text,'') NOT IN ('desk_editor','chief_editor','admin')) THEN
   NEW.human_verified:=false; NEW.verification_status:='pending';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.title_bn IS DISTINCT FROM OLD.title_bn OR NEW.content_bn IS DISTINCT FROM OLD.content_bn OR NEW.featured_image IS DISTINCT FROM OLD.featured_image) THEN
   IF auth.uid() IS NULL OR COALESCE(public.current_app_role()::text,'') NOT IN ('desk_editor','chief_editor','admin') THEN
    NEW.human_verified:=false; NEW.verification_status:='pending';
   END IF;
  END IF;
  IF NEW.status='published' AND (NEW.human_verified IS NOT TRUE OR NEW.verification_status IS DISTINCT FROM 'verified') THEN
   NEW.status:='pending'; NEW.editorial_status:='pending_review'; NEW.workflow_status:='draft'; NEW.published_at:=NULL;
   NEW.review_reason:='reporter_requires_editorial_approval';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS articles_field_report_publish_guard ON public.articles;
CREATE TRIGGER articles_field_report_publish_guard BEFORE INSERT OR UPDATE ON public.articles
 FOR EACH ROW EXECUTE FUNCTION public.articles_field_report_publish_guard();
COMMIT;
