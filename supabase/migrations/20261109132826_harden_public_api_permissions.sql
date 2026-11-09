-- Production hardening: close secret RPC, remove unconditional public video reads,
-- and make AI gateway daily usage server-only.
BEGIN;

-- Secret access is internal to trusted server-side code only.
REVOKE ALL ON FUNCTION public.get_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_secret(text) TO service_role;
ALTER FUNCTION public.get_secret(text) SET search_path = '';

-- Keep the intended public video feed limited to published/live rows.
DROP POLICY IF EXISTS "Allow Public Select Videos" ON public.videos;

-- Gateway quota counters are internal; client roles must not read or mutate them.
REVOKE ALL PRIVILEGES ON TABLE public.ai_gateway_daily_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_gateway_daily_usage TO service_role;

COMMIT;
