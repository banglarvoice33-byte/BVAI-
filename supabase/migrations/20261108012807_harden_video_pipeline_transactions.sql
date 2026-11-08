-- BVAI transactional media pipeline hardening.
-- Additive and replay-safe: preserves existing editorial content and records.
ALTER TABLE public.video_generation_jobs
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS video_generation_assets_job_kind_uidx
  ON public.video_generation_assets(job_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS videos_one_per_article_uidx
  ON public.videos(article_id) WHERE article_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_video_generation_job(p_article_id uuid DEFAULT NULL)
RETURNS TABLE(article_id uuid, job_id uuid, claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_article_id uuid; v_job_id uuid; v_claim_token uuid := gen_random_uuid();
BEGIN
  SELECT a.id INTO v_article_id
  FROM public.articles a
  WHERE a.status = 'published' AND a.content_bn IS NOT NULL AND length(a.content_bn) > 200
    AND (p_article_id IS NULL OR a.id = p_article_id)
    AND NOT EXISTS (SELECT 1 FROM public.videos v WHERE v.article_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM public.video_generation_jobs j
      WHERE j.article_id = a.id AND j.status IN ('queued','processing','needs_review'))
  ORDER BY a.published_at DESC NULLS LAST, a.id
  FOR UPDATE OF a SKIP LOCKED LIMIT 1;
  IF v_article_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.video_generation_jobs
    (article_id,status,attempt_count,claim_token,lease_expires_at,error_message)
  VALUES (v_article_id,'processing',1,v_claim_token,now()+interval '25 minutes',NULL)
  RETURNING id INTO v_job_id;
  RETURN QUERY SELECT v_article_id,v_job_id,v_claim_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_video_generation_job(
  p_job_id uuid,p_article_id uuid,p_claim_token uuid,p_path text,p_signed_url text,
  p_duration_sec integer,p_sha256 text,p_size_bytes bigint
)
RETURNS TABLE(video_id uuid,asset_id uuid,job_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_job public.video_generation_jobs%ROWTYPE; v_article public.articles%ROWTYPE;
        v_video_id uuid; v_asset_id uuid;
BEGIN
  IF p_path IS NULL OR p_path !~ ('^'||p_article_id::text||'/'||p_job_id::text||'-[0-9a-f-]+[.]mp4$')
    OR p_signed_url IS NULL OR p_duration_sec < 1 OR p_duration_sec > 3600
    OR p_size_bytes < 1024 OR p_size_bytes > 104857600
    OR p_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_finalization_metadata'; END IF;

  SELECT * INTO v_job FROM public.video_generation_jobs
  WHERE id=p_job_id AND article_id=p_article_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'generation_job_not_found'; END IF;

  IF v_job.status='needs_review' AND v_job.render_path=p_path AND v_job.video_id IS NOT NULL THEN
    SELECT id INTO v_asset_id FROM public.video_generation_assets
    WHERE job_id=p_job_id AND kind='render';
    RETURN QUERY SELECT v_job.video_id,v_asset_id,v_job.status; RETURN;
  END IF;
  IF v_job.status<>'processing' OR v_job.claim_token IS DISTINCT FROM p_claim_token
    THEN RAISE EXCEPTION 'job_claim_mismatch_or_not_processing'; END IF;

  SELECT * INTO v_article FROM public.articles WHERE id=p_article_id AND status='published';
  IF NOT FOUND THEN RAISE EXCEPTION 'article_not_published'; END IF;

  INSERT INTO public.videos(article_id,title_bn,title_en,description_bn,category_key,
    thumbnail_url,video_url,source_url,duration_sec,duration_seconds,status)
  VALUES(p_article_id,v_article.title_bn,COALESCE(v_article.title_en,''),COALESCE(v_article.content_bn,''),
    COALESCE(v_article.category,'national'),COALESCE(v_article.thumbnail_url,''),p_signed_url,NULL,
    p_duration_sec,p_duration_sec,'needs_review')
  RETURNING id INTO v_video_id;

  INSERT INTO public.video_generation_assets(job_id,kind,provider,external_id,url,license,metadata)
  VALUES(p_job_id,'render','supabase_storage',p_path,p_signed_url,'original_or_cleared',
    jsonb_build_object('bucket','reels','path',p_path,'sha256',p_sha256,'size_bytes',p_size_bytes,
      'duration_sec',p_duration_sec,'mime_type','video/mp4','verified_at',now()))
  RETURNING id INTO v_asset_id;

  UPDATE public.video_generation_jobs SET video_id=v_video_id,render_path=p_path,status='needs_review',
    lease_expires_at=NULL,updated_at=now(),error_message=NULL WHERE id=p_job_id;
  RETURN QUERY SELECT v_video_id,v_asset_id,'needs_review'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_video_generation_job(p_job_id uuid,p_claim_token uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.video_generation_jobs SET status='failed',
    error_message=left(COALESCE(p_reason,'Pipeline failed'),1000),
    lease_expires_at=NULL,updated_at=now()
  WHERE id=p_job_id AND status='processing' AND claim_token=p_claim_token;
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count=1;
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_expired_video_generation_jobs()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.video_generation_jobs SET status='failed',
    error_message='Worker lease expired; safe to retry after inspection',
    lease_expires_at=NULL,updated_at=now()
  WHERE status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at<now();
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_video_generation_job(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finalize_video_generation_job(uuid,uuid,uuid,text,text,integer,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_video_generation_job(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.recover_expired_video_generation_jobs() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_generation_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_video_generation_job(uuid,uuid,uuid,text,text,integer,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_video_generation_job(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_expired_video_generation_jobs() TO service_role;
