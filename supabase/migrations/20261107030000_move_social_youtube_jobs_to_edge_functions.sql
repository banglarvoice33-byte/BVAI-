-- Move social dispatch, social manager and YouTube sync off the Vercel app.
-- The jobs are created inactive; deploy/enable-edge-automation-schedules.sql is
-- the explicit opt-in activation step after Edge Function secrets are configured.
begin;

-- Remove the Vercel-backed schedules and any previous Edge variants.
select cron.unschedule(jobname)
from cron.job
where jobname in (
  'social-dispatch-daytime',
  'social-dispatch-overnight',
  'social-manager-daily',
  'social-manager-metrics',
  'social-manager-weekly',
  'youtube-sync-daily'
);

-- Create Supabase-native targets. The only runtime origin is SUPABASE_URL.
select cron.schedule('social-dispatch-daytime', '5-59/15 0-17 * * *', $$
  select net.http_post(
    url := public.deployment_setting('SUPABASE_URL') || '/functions/v1/social-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), ''),
      'x-cron-secret', coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
$$);

select cron.schedule('social-dispatch-overnight', '5 18-23 * * *', $$
  select net.http_post(
    url := public.deployment_setting('SUPABASE_URL') || '/functions/v1/social-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), ''),
      'x-cron-secret', coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
$$);

select cron.schedule('social-manager-daily', '10 1 * * *', $$
  select net.http_post(
    url := public.deployment_setting('SUPABASE_URL') || '/functions/v1/social-manager',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), ''), 'x-cron-secret', coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), '')),
    body := '{"task":"daily_plan"}'::jsonb,
    timeout_milliseconds := 90000
  );
$$);

select cron.schedule('social-manager-metrics', '20 */6 * * *', $$
  select net.http_post(
    url := public.deployment_setting('SUPABASE_URL') || '/functions/v1/social-manager',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), ''), 'x-cron-secret', coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), '')),
    body := '{"task":"metrics"}'::jsonb,
    timeout_milliseconds := 90000
  );
$$);

select cron.schedule('social-manager-weekly', '40 1 * * 1', $$
  select net.http_post(
    url := public.deployment_setting('SUPABASE_URL') || '/functions/v1/social-manager',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), ''), 'x-cron-secret', coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), '')),
    body := '{"task":"weekly_strategy"}'::jsonb,
    timeout_milliseconds := 90000
  );
$$);

select cron.schedule('youtube-sync-daily', '30 18 * * *', $$
  select net.http_post(
    url := public.deployment_setting('SUPABASE_URL') || '/functions/v1/youtube-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), ''), 'x-cron-secret', coalesce((select ds.decrypted_secret from vault.decrypted_secrets ds join public.api_vault v on v.key_encrypted = ds.id where v.service_name = 'NEWSROOM_INGEST_KEY' and v.environment = 'prod' and v.is_active = true limit 1), '')),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
$$);

-- Fresh provisioning remains safe by default.
update cron.job
set active = false
where jobname in (
  'social-dispatch-daytime',
  'social-dispatch-overnight',
  'social-manager-daily',
  'social-manager-metrics',
  'social-manager-weekly',
  'youtube-sync-daily'
);

commit;
