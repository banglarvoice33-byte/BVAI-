-- Do not activate costly or duplicate schedulers during fresh provisioning.
-- Enable selected jobs only after origins, Vault secrets and budget are configured.
do $$
begin
 if to_regclass('cron.job') is not null then
   update cron.job set active = false where jobname in (
    'news-ingest-5min','news-ingest-daytime','news-ingest-overnight',
    'social-dispatch-daytime','social-dispatch-overnight','epaper-daily',
    'newsroom-failed-retry','newsletter-worker','social-manager',
    'youtube-sync','youtube-sync-daily','social-manager-daily','social-manager-metrics',
    'social-manager-weekly','news-pipeline','newsroom-worker');
 end if;
end; $$;
