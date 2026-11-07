-- Reduce Vercel-bound pg_cron calls (Hobby Fluid Active CPU limit).
-- Idempotent: looks jobs up by name, safe to replay.
do $$
declare
  v_id bigint;
begin
  select jobid into v_id from cron.job where jobname = 'newsroom-failed-retry';
  if v_id is not null then
    perform cron.alter_job(v_id, schedule := '*/30 * * * *');
  end if;

  -- 00:00-05:59 Asia/Dhaka (18:00-23:59 UTC): hourly instead of every 15 minutes.
  select jobid into v_id from cron.job where jobname = 'news-ingest-overnight';
  if v_id is not null then
    perform cron.alter_job(v_id, schedule := '0 18-23 * * *');
  end if;
end
$$;
