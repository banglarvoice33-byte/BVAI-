-- Coordinated rollback ONLY: pause renders/delivery and restore the matching previous application release.
-- Retains audit/experiment data. Restores the previous review-first policy; it does NOT publish anything.
BEGIN;
DROP TRIGGER IF EXISTS enforce_video_quality_approval ON public.videos;
DROP TRIGGER IF EXISTS enforce_video_asset_approval ON public.video_delivery_assets;
DO $$ BEGIN
 IF to_regprocedure('public.finalize_media_delivery_v1(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb)') IS NOT NULL THEN
  DROP FUNCTION public.finalize_media_delivery(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb);
  ALTER FUNCTION public.finalize_media_delivery_v1(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb) RENAME TO finalize_media_delivery;
 END IF;
 IF to_regprocedure('public.record_video_quality_review_v1(uuid,jsonb)') IS NOT NULL THEN
  DROP FUNCTION public.record_video_quality_review(uuid,jsonb);
  ALTER FUNCTION public.record_video_quality_review_v1(uuid,jsonb) RENAME TO record_video_quality_review;
 END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.finalize_media_delivery(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_video_quality_review(uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.require_video_quality_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='published' THEN
  IF NOT EXISTS(SELECT 1 FROM public.video_delivery_assets a JOIN public.video_quality_approvals q ON q.job_id=a.job_id
   WHERE a.video_id=NEW.id AND q.video_sha256=a.sha256 AND q.script_sha256=a.manifest->>'spoken_script_hash' AND q.expires_at>now())
  THEN RAISE EXCEPTION 'fresh_asset_bound_video_approval_required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_video_quality_approval BEFORE INSERT OR UPDATE OF status ON public.videos
 FOR EACH ROW EXECUTE FUNCTION public.require_video_quality_approval();
CREATE OR REPLACE FUNCTION public.video_gate_basis(p_article_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN a.id IS NULL OR a.status IS DISTINCT FROM 'published' THEN NULL
 WHEN a.human_verified IS TRUE AND a.verification_status='verified' THEN 'editorial'
 WHEN a.field_report_id IS NOT NULL OR a.origin IS DISTINCT FROM 'aggregated' THEN NULL
 WHEN s.id IS NOT NULL AND s.enabled IS TRUE AND s.kill_switch IS NOT TRUE AND nullif(btrim(a.source_name),'') IS NOT NULL
 AND a.source_url ~* '^https?://[^ ]+$' AND a.verification_status IN ('auto_verified','verified') AND a.source_published_at IS NOT NULL THEN 'trusted_source'
 ELSE NULL END FROM (SELECT 1)x LEFT JOIN public.articles a ON a.id=p_article_id LEFT JOIN public.news_sources s ON s.id=a.source_id
$$;
CREATE OR REPLACE FUNCTION public.articles_field_report_publish_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.field_report_id IS NOT NULL AND NEW.status='published'
 AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published') AND NEW.human_verified IS NOT TRUE THEN
  NEW.status:='pending';NEW.editorial_status:='pending_review';NEW.workflow_status:='draft';NEW.published_at:=NULL;
  NEW.review_reason:=COALESCE(nullif(NEW.review_reason,''),'reporter_requires_editorial_approval');
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS articles_field_report_publish_guard ON public.articles;
CREATE TRIGGER articles_field_report_publish_guard BEFORE INSERT OR UPDATE OF status,human_verified ON public.articles
 FOR EACH ROW EXECUTE FUNCTION public.articles_field_report_publish_guard();
UPDATE public.video_experiments SET status='stopped';
REVOKE EXECUTE ON FUNCTION public.record_video_experiment_event(text,text,uuid,text,text,text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.approve_reporter_article(uuid,text) FROM authenticated;
COMMIT;
