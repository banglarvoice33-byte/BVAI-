-- MANUAL OPT-IN ONLY. Use either pg_cron OR GitHub automation OR continuous worker.
-- Never enable all three. No existing production DB should use this fresh-install script.
begin;
-- Fail before enabling schedules if new origins or the encrypted ingest secret are absent.
select public.deployment_setting('SITE_URL');
select public.deployment_setting('SUPABASE_URL');
do $$
begin
 if not exists (
   select 1 from public.api_vault v join vault.decrypted_secrets s on s.id=v.key_encrypted
   where v.service_name='NEWSROOM_INGEST_KEY' and v.environment='prod' and v.is_active
     and length(s.decrypted_secret)>=32
 ) then raise exception 'Configure new ingest secret in Vault first'; end if;
 -- Avoid overlapping historic variants; core automation only. Optional video/newsletter remain OFF.
 update cron.job set active=false where jobname in (
  'news-ingest-daytime','news-ingest-overnight','newsroom-failed-retry',
  'social-dispatch-daytime','social-dispatch-overnight','epaper-daily');
 perform cron.alter_job(jobid, schedule := '*/12 0-17 * * *', active := true)
 from cron.job where jobname='news-ingest-daytime';
 perform cron.alter_job(jobid, schedule := '*/12 18-23 * * *', active := true)
 from cron.job where jobname='news-ingest-overnight';
 perform cron.alter_job(jobid, schedule := '27 */4 * * *', active := true)
 from cron.job where jobname='social-dispatch-daytime';
 perform cron.alter_job(jobid, schedule := '30 17 * * *', active := true)
 from cron.job where jobname='epaper-daily';
end $$;
commit;
