-- Rollback for 20261110233227_trusted_source_video_gate.sql.
-- Restores the hard human-verification gate (human_verified=true AND verification_status='verified'
-- and 2 fresh evidence items), then drops the gate function. Run only after stopping video render/delivery.
DO $rb$
DECLARE
  fn_c constant regprocedure := 'public.claim_reviewed_video_job(uuid)'::regprocedure;
  def_c text := pg_get_functiondef(fn_c);
  fn_f constant regprocedure := 'public.finalize_media_delivery(uuid,uuid,uuid,text,text,integer,text,bigint,boolean,jsonb,jsonb)'::regprocedure;
  def_f text := pg_get_functiondef(fn_f);
  c_new constant text := $a$AND public.video_gate_basis(a.id) IS NOT NULL$a$;
  c_old constant text := $a$AND a.human_verified=true AND a.verification_status='verified'$a$;
  f_new1 constant text := $a$  -- Policy: editor-approved content OR curated trusted-source news (see video_gate_basis). Reporter/field/original content stays human-gated.
  IF p_publish AND public.video_gate_basis(p_article_id) IS NULL THEN RAISE EXCEPTION 'editorial_verification_required'; END IF;$a$;
  f_old1 constant text := $a$  IF p_publish AND (a.human_verified IS DISTINCT FROM true OR a.verification_status IS DISTINCT FROM 'verified') THEN RAISE EXCEPTION 'editorial_verification_required'; END IF;$a$;
  f_new2 constant text := $a$<(CASE WHEN public.video_gate_basis(p_article_id)='trusted_source' THEN 1 ELSE 2 END)) THEN$a$;
  f_old2 constant text := $a$<2) THEN$a$;
BEGIN
  IF position(c_new IN def_c)=0 OR position(f_new1 IN def_f)=0 OR position(f_new2 IN def_f)=0 THEN
    RAISE EXCEPTION 'rollback_drift: gate text not found; nothing changed';
  END IF;
  EXECUTE replace(def_c, c_new, c_old);
  EXECUTE replace(replace(def_f, f_new1, f_old1), f_new2, f_old2);
END
$rb$;
DROP FUNCTION IF EXISTS public.video_gate_basis(uuid);
