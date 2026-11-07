-- MANUAL OPT-IN ONLY.
-- Run only after deploying social-dispatch, social-manager and youtube-sync.
-- These jobs call Supabase Edge Functions, never the Vercel site.
begin;

select public.deployment_setting('SUPABASE_URL');

do $$
begin
  if not exists (
    select 1
    from public.api_vault v
    join vault.decrypted_secrets s on s.id = v.key_encrypted
    where v.service_name = 'NEWSROOM_INGEST_KEY'
      and v.environment = 'prod'
      and v.is_active
      and length(s.decrypted_secret) >= 32
  ) then
    raise exception 'Configure NEWSROOM_INGEST_KEY in Vault first';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname in (
      'social-dispatch-daytime',
      'social-dispatch-overnight',
      'social-manager-daily',
      'social-manager-metrics',
      'social-manager-weekly',
      'youtube-sync-daily'
    )
    group by 1
    having count(*) = 6
  ) then
    raise exception 'Apply the Edge Function scheduler migration first';
  end if;

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

  update cron.job
  set active = true
  where jobname in (
    'social-dispatch-daytime',
    'social-dispatch-overnight',
    'social-manager-daily',
    'social-manager-metrics',
    'social-manager-weekly',
    'youtube-sync-daily'
  );
end $$;

commit;
