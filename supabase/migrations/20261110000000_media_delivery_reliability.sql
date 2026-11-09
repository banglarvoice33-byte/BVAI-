-- Forward-only extension of the November 9 website contract; no scheduler activation.
-- Apply ONLY after 20261109060000_website_only_video_delivery.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS public.video_story_reservations (
  content_key text PRIMARY KEY CHECK(content_key ~ '^[a-f0-9]{64}$'),
  script_hash text NOT NULL UNIQUE CHECK(script_hash ~ '^[a-f0-9]{64}$'),
  job_id uuid NOT NULL UNIQUE REFERENCES public.video_generation_jobs(id),
  content_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.video_visual_reservations (
 sha256 text PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 job_id uuid NOT NULL REFERENCES public.video_generation_jobs(id),
 source_url text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.video_delivery_assets (
  video_id uuid PRIMARY KEY REFERENCES public.videos(id),
  job_id uuid NOT NULL UNIQUE REFERENCES public.video_generation_jobs(id),
  sha256 text NOT NULL UNIQUE CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.video_broll_reservations (
  sha256 text PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  job_id uuid NOT NULL REFERENCES public.video_generation_jobs(id),
  source_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Intentionally isolated from the older optional video_distribution_jobs contract,
-- which the November 9 migration says is absent in production.
CREATE TABLE IF NOT EXISTS public.video_delivery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id),
  platform text NOT NULL CHECK(platform IN ('youtube','facebook','instagram')),
  account_id text NOT NULL CHECK(length(account_id)>0),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','retrying','succeeded','needs_reconciliation','dead_letter','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0,
  claim_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_id,platform,account_id)
);
CREATE INDEX IF NOT EXISTS video_delivery_due ON public.video_delivery_outbox(next_attempt_at) WHERE status IN ('queued','retrying');
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['video_visual_reservations','video_story_reservations','video_delivery_assets','video_delivery_outbox','video_broll_reservations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
    EXECUTE format('DROP POLICY IF EXISTS service_only ON public.%I',t);
    EXECUTE format('CREATE POLICY service_only ON public.%I FOR ALL TO service_role USING(true) WITH CHECK(true)',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.claim_reviewed_video_job(p_article_id uuid DEFAULT NULL)
RETURNS TABLE(article_id uuid,job_id uuid,claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chosen uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(73920511);
  -- Count failed attempts too: failed provider calls can still cost money.
  IF (SELECT count(*) FROM public.video_generation_jobs WHERE created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))>=10 THEN RETURN; END IF;
  SELECT a.id INTO chosen FROM public.articles a
  WHERE a.status='published' AND length(a.content_bn)>200
    AND a.human_verified=true AND a.verification_status='verified'
    AND a.source_published_at BETWEEN now()-interval '24 hours' AND now()+interval '5 minutes'
    AND (p_article_id IS NULL OR a.id=p_article_id)
    AND NOT EXISTS(SELECT 1 FROM public.videos v WHERE v.article_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM public.video_generation_jobs j WHERE j.article_id=a.id AND j.status IN ('queued','processing','needs_review','publishing'))
    AND (SELECT count(*) FROM public.video_generation_jobs j WHERE j.article_id=a.id AND j.created_at>now()-interval '24 hours')<3
  ORDER BY a.published_at DESC NULLS LAST,a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1;
  IF chosen IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.claim_video_generation_job(chosen);
END $$;

CREATE OR REPLACE FUNCTION public.renew_render_claim(p_job_id uuid,p_claim_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.video_generation_jobs%ROWTYPE; token uuid:=gen_random_uuid();
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(73920511);
  SELECT * INTO j FROM public.video_generation_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR j.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'recovery_claim_mismatch'; END IF;
  IF j.status IN ('needs_review','completed') OR (j.status='processing' AND j.lease_expires_at>now()) THEN RETURN j.claim_token; END IF;
  IF j.status NOT IN ('processing','failed') OR j.video_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.videos WHERE article_id=j.article_id)
    OR EXISTS(SELECT 1 FROM public.video_generation_jobs WHERE article_id=j.article_id AND id<>j.id AND status IN ('processing','queued','needs_review','publishing'))
    OR NOT EXISTS(SELECT 1 FROM public.video_story_reservations WHERE job_id=j.id) THEN RAISE EXCEPTION 'render_not_safely_recoverable'; END IF;
  UPDATE public.video_generation_jobs SET claim_token=token,status='processing',lease_expires_at=now()+interval '25 minutes',error_message=NULL,updated_at=now() WHERE id=j.id;
  RETURN token;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_video_visual(p_job_id uuid,p_claim_token uuid,p_sha256 text,p_source_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_job uuid;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(73920513);
 IF NOT EXISTS(SELECT 1 FROM public.video_generation_jobs WHERE id=p_job_id AND claim_token=p_claim_token AND status='processing' AND lease_expires_at>now()) THEN RAISE EXCEPTION 'invalid_visual_claim'; END IF;
 SELECT r.job_id INTO owner_job FROM public.video_visual_reservations r WHERE sha256=p_sha256;
 IF owner_job=p_job_id THEN RETURN true; END IF;
 IF owner_job IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.video_generation_jobs WHERE id=owner_job AND status IN ('failed','cancelled') AND video_id IS NULL) THEN RAISE EXCEPTION 'video_visual_already_used'; END IF;
  DELETE FROM public.video_visual_reservations WHERE sha256=p_sha256;
 END IF;
 INSERT INTO public.video_visual_reservations(sha256,job_id,source_url) VALUES(p_sha256,p_job_id,p_source_url);
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_video_story(p_job_id uuid,p_claim_token uuid,p_content_key text,p_script_hash text,p_content_text text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_job uuid; old_status text;
BEGIN
  -- Serialize global exact-content reservations across all runners.
  PERFORM pg_catalog.pg_advisory_xact_lock(73920512);
  IF NOT EXISTS(SELECT 1 FROM public.video_generation_jobs WHERE id=p_job_id AND claim_token=p_claim_token AND status='processing' AND lease_expires_at>now()) THEN RAISE EXCEPTION 'invalid_story_claim'; END IF;
  SELECT r.job_id,j.status INTO old_job,old_status FROM public.video_story_reservations r JOIN public.video_generation_jobs j ON j.id=r.job_id WHERE r.content_key=p_content_key OR r.script_hash=p_script_hash LIMIT 1;
  IF old_job=p_job_id THEN RETURN true; END IF;
  IF old_job IS NOT NULL THEN
    IF old_status NOT IN ('failed','cancelled') OR EXISTS(SELECT 1 FROM public.video_generation_jobs WHERE id=old_job AND video_id IS NOT NULL) THEN RAISE EXCEPTION 'duplicate_story_or_script'; END IF;
    DELETE FROM public.video_story_reservations WHERE job_id=old_job;
  END IF;
  INSERT INTO public.video_story_reservations(content_key,script_hash,job_id,content_text) VALUES(p_content_key,p_script_hash,p_job_id,left(p_content_text,30000));
  RETURN true;
END $$;

-- Explicit operator recovery for an interrupted upload. It cannot supersede a
-- replacement job or an already-linked video; the original claim token is required.
CREATE OR REPLACE FUNCTION public.renew_media_upload_claim(p_job_id uuid,p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.video_generation_jobs%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(73920511);
  SELECT * INTO j FROM public.video_generation_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR j.claim_token IS DISTINCT FROM p_claim_token OR j.status NOT IN ('processing','failed') OR j.video_id IS NOT NULL THEN RAISE EXCEPTION 'upload_recovery_not_safe'; END IF;
  IF EXISTS(SELECT 1 FROM public.videos WHERE article_id=j.article_id) OR EXISTS(SELECT 1 FROM public.video_generation_jobs WHERE article_id=j.article_id AND id<>j.id AND status IN ('queued','processing','needs_review','publishing','completed')) THEN RAISE EXCEPTION 'replacement_media_job_exists'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.video_story_reservations WHERE job_id=j.id) THEN RAISE EXCEPTION 'original_story_reservation_missing'; END IF;
  UPDATE public.video_generation_jobs SET status='processing',lease_expires_at=now()+interval '25 minutes',error_message=NULL,updated_at=now() WHERE id=j.id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_video_broll(p_job_id uuid,p_claim_token uuid,p_sha256 text,p_source_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_job uuid; old_status text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(73920513);
  IF NOT EXISTS(SELECT 1 FROM public.video_generation_jobs WHERE id=p_job_id AND claim_token=p_claim_token AND status='processing' AND lease_expires_at>now()) THEN RAISE EXCEPTION 'invalid_broll_claim'; END IF;
  SELECT r.job_id,j.status INTO old_job,old_status FROM public.video_broll_reservations r JOIN public.video_generation_jobs j ON j.id=r.job_id WHERE r.sha256=p_sha256;
  IF old_job=p_job_id THEN RETURN true; END IF;
  IF old_job IS NOT NULL THEN
    IF old_status NOT IN ('failed','cancelled') OR EXISTS(SELECT 1 FROM public.video_generation_jobs WHERE id=old_job AND video_id IS NOT NULL) THEN RAISE EXCEPTION 'broll_already_used'; END IF;
    DELETE FROM public.video_broll_reservations WHERE sha256=p_sha256;
  END IF;
  INSERT INTO public.video_broll_reservations(sha256,job_id,source_url) VALUES(p_sha256,p_job_id,p_source_url);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.finalize_media_delivery(
  p_job_id uuid,p_article_id uuid,p_claim_token uuid,p_path text,p_signed_url text,
  p_duration_sec integer,p_sha256 text,p_size_bytes bigint,p_publish boolean,
  p_manifest jsonb,p_targets jsonb DEFAULT '[]'::jsonb
) RETURNS TABLE(video_id uuid,job_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_status text; target jsonb; a public.articles%ROWTYPE; j public.video_generation_jobs%ROWTYPE;
BEGIN
  IF p_publish IS NULL OR p_path IS NULL OR p_signed_url IS NULL OR p_duration_sec IS NULL OR p_duration_sec<40 OR p_duration_sec>120 OR p_sha256 IS NULL OR p_size_bytes IS NULL OR p_manifest IS NULL OR p_targets IS NULL THEN RAISE EXCEPTION 'invalid_media_contract'; END IF;
  IF jsonb_typeof(p_targets)<>'array' OR jsonb_array_length(p_targets)>3 THEN RAISE EXCEPTION 'invalid_delivery_targets'; END IF;
  SELECT * INTO j FROM public.video_generation_jobs WHERE id=p_job_id AND article_id=p_article_id FOR UPDATE;
  IF NOT FOUND OR j.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'media_claim_mismatch'; END IF;
  IF j.status='processing' AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=now()) THEN RAISE EXCEPTION 'media_lease_expired'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.video_story_reservations WHERE job_id=p_job_id AND script_hash=p_manifest->>'script_hash' AND content_key=p_manifest->>'content_key') THEN RAISE EXCEPTION 'missing_story_reservation'; END IF;
  SELECT * INTO a FROM public.articles WHERE id=p_article_id;
  IF p_publish AND (a.human_verified IS DISTINCT FROM true OR a.verification_status IS DISTINCT FROM 'verified') THEN RAISE EXCEPTION 'editorial_verification_required'; END IF;
  IF p_publish AND (a.source_published_at IS NULL OR a.source_published_at<now()-interval '24 hours' OR a.source_published_at>now()+interval '5 minutes') THEN RAISE EXCEPTION 'primary_source_stale'; END IF;
  IF p_publish AND (jsonb_typeof(p_manifest->'evidence') IS DISTINCT FROM 'array' OR (SELECT count(*) FROM jsonb_array_elements(p_manifest->'evidence') e WHERE e->>'role'='news_source' AND e->>'sha256' ~ '^[a-f0-9]{64}$' AND (e->>'fetched_at')::timestamptz>now()-interval '24 hours')<2) THEN RAISE EXCEPTION 'fresh_evidence_required'; END IF;
  IF NOT p_publish AND jsonb_array_length(p_targets)>0 THEN RAISE EXCEPTION 'review_cannot_distribute'; END IF;
  IF p_manifest->>'caption_method' NOT IN ('groq-whisper','edge-matched') OR p_manifest->>'caption_method' IS NULL THEN RAISE EXCEPTION 'actual_audio_captions_required'; END IF;
  -- Strip worker claim credentials and local filesystem paths from stored manifest.
  SELECT f.video_id,f.job_status INTO v_id,v_status FROM public.finalize_website_video(p_job_id,p_article_id,p_claim_token,p_path,p_signed_url,p_duration_sec,p_sha256,p_size_bytes,p_publish) f;
  INSERT INTO public.video_delivery_assets(video_id,job_id,sha256,manifest)
  VALUES(v_id,p_job_id,p_sha256,p_manifest-'claim_token'-'video_path')
  ON CONFLICT ON CONSTRAINT video_delivery_assets_pkey DO UPDATE SET manifest=EXCLUDED.manifest WHERE video_delivery_assets.sha256=EXCLUDED.sha256;
  IF NOT EXISTS(SELECT 1 FROM public.video_delivery_assets WHERE video_delivery_assets.video_id=v_id AND sha256=p_sha256) THEN RAISE EXCEPTION 'asset_replay_mismatch'; END IF;
  -- Keep complete rights/source attribution visible on the website as well as social descriptions.
  UPDATE public.videos SET description_bn=COALESCE(a.content_bn,'')||E'\n\nসূত্র:\n'||
    COALESCE((SELECT string_agg(e->>'url',E'\n') FROM jsonb_array_elements(COALESCE(p_manifest->'evidence','[]'::jsonb)) e WHERE e->>'role'='news_source'),'')||
    E'\nপ্রতীকী দৃশ্য / ক্রেডিট:\n'||COALESCE((SELECT string_agg(COALESCE(m->>'author','')||' | '||COALESCE(m->>'license','')||' | '||COALESCE(m->>'source_url','')||' | '||COALESCE(m->>'license_url','')||' | vertical edit',E'\n') FROM jsonb_array_elements(COALESCE(p_manifest->'media','[]'::jsonb)) m),'')
  WHERE id=v_id;
  UPDATE public.videos SET description_bn=COALESCE(a.content_bn,'') || E'\n\nসূত্র:\n' ||
    COALESCE((SELECT string_agg(e->>'url',E'\n') FROM jsonb_array_elements(COALESCE(p_manifest->'evidence','[]'::jsonb)) e WHERE e->>'role'='news_source' AND e ? 'sha256'),'') || E'\n\nপ্রতীকী দৃশ্য — উৎস ও লাইসেন্স:\n' ||
    COALESCE((SELECT string_agg(concat_ws(' | ',m->>'author',m->>'license',m->>'source_url',m->>'license_url'),E'\n') FROM jsonb_array_elements(COALESCE(p_manifest->'media','[]'::jsonb)) m),'')
  WHERE videos.id=v_id;
  IF p_publish THEN
    -- articles.video_id is legacy external-YouTube TEXT, not public.videos UUID.
    -- Do not corrupt that semantic contract by writing a local UUID into it.
    UPDATE public.articles SET video_generated=true,video_generated_at=COALESCE(video_generated_at,now()),updated_at=now() WHERE id=p_article_id;
    FOR target IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
      INSERT INTO public.video_delivery_outbox(video_id,platform,account_id)
      VALUES(v_id,target->>'platform',target->>'account_id') ON CONFLICT ON CONSTRAINT video_delivery_outbox_video_id_platform_account_id_key DO NOTHING;
    END LOOP;
  END IF;
  RETURN QUERY SELECT v_id,v_status;
END $$;

CREATE OR REPLACE FUNCTION public.claim_media_delivery(p_platform text,p_account_id text)
RETURNS SETOF public.video_delivery_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chosen uuid;
BEGIN
  -- Expired in-flight side effects MUST NOT blindly create a second public post.
  UPDATE public.video_delivery_outbox SET status=CASE WHEN checkpoint='{}'::jsonb THEN 'retrying' ELSE 'needs_reconciliation' END,claim_token=NULL,lease_expires_at=NULL,updated_at=now(),last_error='Worker lease expired; inspect provider checkpoint'
  WHERE status='processing' AND lease_expires_at<now();
  SELECT q.id INTO chosen FROM public.video_delivery_outbox q JOIN public.videos v ON v.id=q.video_id
    WHERE q.platform=p_platform AND q.account_id=p_account_id AND q.status IN ('queued','retrying') AND q.next_attempt_at<=now() AND q.attempt_count<5 AND v.status='published'
    ORDER BY q.next_attempt_at FOR UPDATE OF q SKIP LOCKED LIMIT 1;
  IF chosen IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.video_delivery_outbox SET status='processing',attempt_count=attempt_count+1,claim_token=gen_random_uuid(),lease_expires_at=now()+interval '15 minutes',updated_at=now() WHERE id=chosen RETURNING *;
END $$;
CREATE OR REPLACE FUNCTION public.checkpoint_media_delivery(p_id uuid,p_token uuid,p_checkpoint jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.video_delivery_outbox SET checkpoint=checkpoint||p_checkpoint,lease_expires_at=now()+interval '15 minutes',updated_at=now()
  WHERE id=p_id AND claim_token=p_token AND status='processing' AND lease_expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery_fence_lost'; END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.finish_media_delivery(p_id uuid,p_token uuid,p_status text,p_result jsonb DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.video_delivery_outbox%ROWTYPE;
BEGIN
  IF p_status NOT IN ('succeeded','retrying','needs_reconciliation','dead_letter') THEN RAISE EXCEPTION 'invalid_delivery_status'; END IF;
  SELECT * INTO q FROM public.video_delivery_outbox WHERE id=p_id AND claim_token=p_token AND status='processing' AND lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery_fence_lost'; END IF;
  IF p_status='succeeded' AND COALESCE(p_result->>'id','')='' THEN RAISE EXCEPTION 'missing_provider_receipt'; END IF;
  UPDATE public.video_delivery_outbox SET status=CASE WHEN p_status='retrying' AND attempt_count>=5 THEN 'dead_letter' ELSE p_status END,result=p_result,last_error=left(p_error,1000),claim_token=NULL,lease_expires_at=NULL,next_attempt_at=now()+make_interval(secs=>least(3600,60*(2^q.attempt_count)::integer)),updated_at=now() WHERE id=p_id;
  IF p_status='succeeded' THEN
    UPDATE public.videos SET platform_posted=COALESCE(platform_posted,'{}'::jsonb)||jsonb_build_object(q.platform,p_result),updated_at=now() WHERE id=q.video_id;
    IF q.platform='youtube' THEN
      UPDATE public.articles SET video_id=p_result->>'id',updated_at=now() WHERE id=(SELECT article_id FROM public.videos WHERE id=q.video_id);
    END IF;
  END IF;
  RETURN true;
END $$;
-- Explicit recovery releases a checkpointed job but NEVER discards its provider identity.
CREATE OR REPLACE FUNCTION public.resume_media_delivery(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.video_delivery_outbox SET status='retrying',next_attempt_at=now(),updated_at=now()
  WHERE id=p_id AND status='needs_reconciliation' AND attempt_count<5
    AND ((platform='youtube' AND checkpoint ? 'upload_url') OR (platform='facebook' AND checkpoint ? 'provider_id') OR (platform='instagram' AND checkpoint ? 'container_id'));
  RETURN FOUND;
END $$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('reserve_video_visual','renew_render_claim','claim_reviewed_video_job','reserve_video_story','finalize_media_delivery','claim_media_delivery','checkpoint_media_delivery','finish_media_delivery','resume_media_delivery') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;
COMMIT;
