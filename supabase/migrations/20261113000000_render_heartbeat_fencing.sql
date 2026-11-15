-- Required by the renderer. Forward-only; does not activate a scheduler or publish media.
BEGIN;
CREATE OR REPLACE FUNCTION public.heartbeat_reviewed_render(p_job_id uuid, p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE touched integer;
BEGIN
  -- UPDATE obtains a row lock and rechecks these predicates after a competing update.
  -- Never resurrect an expired lease or extend a completed/rotated claim.
  UPDATE public.video_generation_jobs
  SET lease_expires_at = pg_catalog.clock_timestamp() + interval '25 minutes',
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_job_id AND claim_token = p_claim_token AND status = 'processing'
    AND lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.heartbeat_reviewed_render(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_reviewed_render(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.heartbeat_reviewed_render(uuid, uuid) IS
  'Extends only a live processing claim with the matching fencing token; service-role workers only.';
COMMIT;
