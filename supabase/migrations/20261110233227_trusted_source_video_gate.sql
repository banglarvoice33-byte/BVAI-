-- Trusted-source video gate (editorial policy decision, 2026-11-11). Applied to BVAI (rtejxeamxeycnpcwnseo) as version 20261110233227.
--
-- POLICY
--   * News republished from a curated, enabled, credited source (articles.origin='aggregated',
--     no field_report_id, source_id -> enabled news_sources row, not kill-switched, source name +
--     http(s) URL, auto_verified/verified, not fallback, source publication time present)
--     needs NO human-in-the-loop before AI video.
--   * Reporter-app / field-report / original / manual content KEEPS mandatory editorial approval
--     (human_verified=true AND verification_status='verified'). Everything else fails closed.
--   * UNCHANGED: 24h source freshness, fresh hashed evidence, real audio captions, 10/day cap
--     (failed attempts count), 3 attempts per article per 24h, claim-token fencing.
--   * ONE deliberate relaxation: fresh independent news evidence needed is 1 (was 2) for
--     basis='trusted_source' ONLY. Editorially approved content still needs 2.
--
-- SAFETY
--   * Live function bodies are patched in place from pg_get_functiondef(), so any later hotfix
--     is preserved. If the live body no longer contains the exact expected text exactly once,
--     the migration ABORTS (schema drift) instead of guessing. The whole file is one transaction.
--   * Function ACLs are preserved (service_role only). Rollback: supabase/rollbacks/ twin file.

CREATE OR REPLACE FUNCTION public.video_gate_basis(p_article_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE
    WHEN a.id IS NULL OR a.status IS DISTINCT FROM 'published' THEN NULL
    WHEN a.human_verified IS TRUE AND a.verification_status = 'verified' THEN 'editorial'
    WHEN a.field_report_id IS NOT NULL OR a.origin IS DISTINCT FROM 'aggregated' THEN NULL
    WHEN s.id IS NOT NULL AND s.enabled IS TRUE AND s.kill_switch IS NOT TRUE
     AND nullif(btrim(a.source_name),'') IS NOT NULL
     AND a.source_url ~* '^https?://[^ ]+$'
     AND a.verification_status IN ('auto_verified','verified')
     AND a.is_fallback IS NOT TRUE
     AND a.source_published_at IS NOT NULL THEN 'trusted_source'
    ELSE NULL
  END
  FROM (SELECT 1) x
  LEFT JOIN public.articles a ON a.id = p_article_id
  LEFT JOIN public.news_sources s ON s.id = a.source_id
$$;
REVOKE ALL ON FUNCTION public.video_gate_basis(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_gate_basis(uuid) TO service_role;

-- 1) claim_reviewed_video_job: candidate selection uses the gate instead of the hard human check.
DO $patch$
DECLARE
  fn  constant regprocedure := 'public.claim_reviewed_video_job(uuid)'::regprocedure;
  def text := pg_get_functiondef(fn);
  old_ constant text := $a$AND a.human_verified=true AND a.verification_status='verified'$a$;
  new_ constant text := $a$AND public.video_gate_basis(a.id) IS NOT NULL$a$;
BEGIN
  IF (length(def) - length(replace(def, old_, ''))) <> length(old_) THEN
    RAISE EXCEPTION 'schema_drift: claim_reviewed_video_job does not contain the expected gate exactly once; migration aborted';
  END IF;
  EXECUTE replace(def, old_, new_);
  IF position('video_gate_basis' IN pg_get_functiondef(fn)) = 0 THEN
    RAISE EXCEPTION 'patch_verification_failed: claim_reviewed_video_job';
  END IF;
END
$patch$;

-- 2) finalize_media_delivery: editorial check via the gate; trusted sources need 1 fresh evidence item.
DO $patch$
DECLARE
  fn   constant regprocedure := 'public.finalize_media_delivery(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb)'::regprocedure;
  def  text := pg_get_functiondef(fn);
  old1 constant text := $a$  IF p_publish AND (a.human_verified IS DISTINCT FROM true OR a.verification_status IS DISTINCT FROM 'verified') THEN RAISE EXCEPTION 'editorial_verification_required'; END IF;$a$;
  new1 constant text := $a$  -- Policy: editor-approved content OR curated trusted-source news (see video_gate_basis). Reporter/field/original content stays human-gated.
  IF p_publish AND public.video_gate_basis(p_article_id) IS NULL THEN RAISE EXCEPTION 'editorial_verification_required'; END IF;$a$;
  old2 constant text := $a$e->>'sha256' ~ '^[a-f0-9]{64}$' AND (e->>'fetched_at')::timestamptz>now()-interval '24 hours')<2) THEN$a$;
  new2 constant text := $a$e->>'sha256' ~ '^[a-f0-9]{64}$' AND (e->>'fetched_at')::timestamptz>now()-interval '24 hours')<(CASE WHEN public.video_gate_basis(p_article_id)='trusted_source' THEN 1 ELSE 2 END)) THEN$a$;
BEGIN
  IF (length(def) - length(replace(def, old1, ''))) <> length(old1)
     OR (length(def) - length(replace(def, old2, ''))) <> length(old2) THEN
    RAISE EXCEPTION 'schema_drift: finalize_media_delivery does not contain the expected checks exactly once; migration aborted';
  END IF;
  EXECUTE replace(replace(def, old1, new1), old2, new2);
  IF position(new1 IN pg_get_functiondef(fn)) = 0 OR position(new2 IN pg_get_functiondef(fn)) = 0 THEN
    RAISE EXCEPTION 'patch_verification_failed: finalize_media_delivery';
  END IF;
END
$patch$;

REVOKE ALL ON FUNCTION public.claim_reviewed_video_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reviewed_video_job(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_media_delivery(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_media_delivery(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb) TO service_role;
