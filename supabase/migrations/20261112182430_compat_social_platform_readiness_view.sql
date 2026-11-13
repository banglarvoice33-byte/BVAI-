-- Already applied live (history version 20261112182430). Do NOT re-run in the SQL Editor.
-- Additive compatibility view: the deployed newsroom code reads public.social_platform_readiness,
-- while the reconciled schema exposes public.social_dispatch_readiness_v2. Without this view every
-- cron run logged "social readiness registry unavailable" and fell into degraded (fail-closed) mode.
-- Read-only, service_role only, same readiness semantics (nothing becomes ready that v2 does not mark ready).
CREATE OR REPLACE VIEW public.social_platform_readiness
WITH (security_invoker = true) AS
SELECT v.platform, v.daily_post_limit, v.min_gap_minutes, v.is_ready
FROM public.social_dispatch_readiness_v2 v;

REVOKE ALL ON public.social_platform_readiness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.social_platform_readiness TO service_role;
COMMENT ON VIEW public.social_platform_readiness IS 'Compatibility alias of social_dispatch_readiness_v2 for newsroom cron-trigger / social dispatch readers.';
