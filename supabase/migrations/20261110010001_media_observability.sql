-- Read-only observability helpers for operators (service_role).
-- No automation enabled. Safe to apply on staging/production after backup.
BEGIN;

CREATE OR REPLACE VIEW public.video_delivery_outbox_age AS
SELECT
  platform,
  status,
  count(*) AS jobs,
  min(created_at) AS oldest_created,
  max(created_at) AS newest_created,
  min(next_attempt_at) AS next_due,
  max(attempt_count) AS max_attempts,
  count(*) FILTER (WHERE status IN ('queued','retrying') AND next_attempt_at < now() - interval '30 minutes') AS overdue_30m,
  count(*) FILTER (WHERE status = 'needs_reconciliation') AS needs_reconciliation,
  count(*) FILTER (WHERE status = 'dead_letter') AS dead_letter
FROM public.video_delivery_outbox
GROUP BY platform, status;

CREATE OR REPLACE VIEW public.source_registry_summary AS
SELECT
  id,
  name_bn,
  name_en,
  domain,
  credibility,
  bias_leaning,
  daily_cap_pct,
  is_active,
  updated_at
FROM public.source_registry
ORDER BY credibility DESC, name_bn;

REVOKE ALL ON public.video_delivery_outbox_age FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.source_registry_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.video_delivery_outbox_age TO service_role;
GRANT SELECT ON public.source_registry_summary TO service_role;

COMMIT;
