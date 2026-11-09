-- Website-only delivery. Apply AFTER the existing video-pipeline migrations.
-- Existing articles/videos/assets are preserved. No social API is invoked.
BEGIN;

-- Existing repository previously activated this queue. Disable both claim/enqueue
-- via their existing database feature gate, without deleting queued history.
UPDATE private.video_distribution_config
SET enabled=false,updated_at=now(),updated_by='website_only_20261109'
WHERE singleton=true;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('reels','reels',false,104857600,ARRAY['video/mp4']::text[])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=104857600,allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.claim_video_generation_job(p_article_id uuid DEFAULT NULL)
RETURNS TABLE(article_id uuid,job_id uuid,claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_article_id uuid;v_job_id uuid;v_claim_token uuid:=gen_random_uuid();
BEGIN
  -- Serialize claims across Termux and Actions; reserve a daily budget slot
  -- before paying any voice provider. UTC budget of 10 successful/active jobs.
  PERFORM pg_advisory_xact_lock(73920511);
  IF (SELECT count(*) FROM public.video_generation_jobs j
      WHERE j.created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AND j.status IN ('queued','processing','needs_review','publishing','completed')) >= 10
  THEN RETURN; END IF;
  SELECT a.id INTO v_article_id FROM public.articles a
  WHERE a.status='published' AND a.content_bn IS NOT NULL AND length(a.content_bn)>200
    AND (p_article_id IS NULL OR a.id=p_article_id)
    AND NOT EXISTS(SELECT 1 FROM public.videos v WHERE v.article_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM public.video_generation_jobs j
      WHERE j.article_id=a.id AND j.status IN ('queued','processing','needs_review','publishing'))
  ORDER BY a.published_at DESC NULLS LAST,a.id
  FOR UPDATE OF a SKIP LOCKED LIMIT 1;
  IF v_article_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.video_generation_jobs(article_id,status,attempt_count,claim_token,lease_expires_at,error_message)
  VALUES(v_article_id,'processing',1,v_claim_token,now()+interval '25 minutes',NULL)
  RETURNING id INTO v_job_id;
  RETURN QUERY SELECT v_article_id,v_job_id,v_claim_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_website_video(
 p_job_id uuid,p_article_id uuid,p_claim_token uuid,p_path text,p_signed_url text,
 p_duration_sec integer,p_sha256 text,p_size_bytes bigint,p_publish boolean DEFAULT true
)
RETURNS TABLE(video_id uuid,job_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_job public.video_generation_jobs%ROWTYPE;v_video_id uuid;
BEGIN
  SELECT * INTO v_job FROM public.video_generation_jobs
    WHERE id=p_job_id AND article_id=p_article_id FOR UPDATE;
  IF NOT FOUND OR v_job.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'website_job_claim_mismatch';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.articles WHERE id=p_article_id AND status='published') THEN
    RAISE EXCEPTION 'source_article_not_published';
  END IF;
  -- Reject replaying a job with a different asset even if it already completed.
  IF v_job.status='completed' THEN
    IF v_job.render_path IS DISTINCT FROM p_path THEN RAISE EXCEPTION 'website_asset_mismatch'; END IF;
    RETURN QUERY SELECT v_job.video_id,'completed'::text;RETURN;
  END IF;
  IF v_job.status NOT IN ('processing','needs_review') THEN RAISE EXCEPTION 'website_job_not_finalizable'; END IF;
  SELECT f.video_id INTO v_video_id FROM public.finalize_video_generation_job(
    p_job_id,p_article_id,p_claim_token,p_path,p_signed_url,p_duration_sec,p_sha256,p_size_bytes
  ) f;
  IF p_publish THEN
    UPDATE public.videos SET status='published',updated_at=now() WHERE id=v_video_id;
    UPDATE public.articles SET video_generated=true,updated_at=now() WHERE id=p_article_id;
    UPDATE public.video_generation_jobs SET status='completed',lease_expires_at=NULL,updated_at=now()
      WHERE id=p_job_id;
    RETURN QUERY SELECT v_video_id,'completed'::text;
  ELSE
    RETURN QUERY SELECT v_video_id,'needs_review'::text;
  END IF;
  -- Deliberately NO enqueue_video_distribution call. Social adapters stay installed
  -- and can be enabled separately after OAuth/account and editorial setup.
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_website_video(uuid,uuid,uuid,text,text,integer,text,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_website_video(uuid,uuid,uuid,text,text,integer,text,bigint,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.claim_video_generation_job(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_generation_job(uuid) TO service_role;
COMMIT;
