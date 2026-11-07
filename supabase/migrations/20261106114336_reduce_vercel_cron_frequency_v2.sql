-- Hobby plan paused for Fluid Active CPU: cut Vercel-bound pg_cron calls again.
-- Daytime = 06:00-23:59 Asia/Dhaka (00:00-17:59 UTC), overnight = 00:00-05:59 Dhaka.
-- Idempotent: jobs are looked up by name; unknown names are skipped.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('news-ingest-daytime',      '0,30 0-17 * * *'),
      ('news-ingest-overnight',    '0 18,20,22 * * *'),
      ('social-dispatch-daytime',  '5,35 0-17 * * *'),
      ('social-dispatch-overnight','5 18,20,22 * * *'),
      ('newsroom-failed-retry',    '15 * * * *')
    ) as v(jobname, sched)
  loop
    perform cron.alter_job(j.jobid, schedule := r.sched)
    from cron.job j
    where j.jobname = r.jobname;
  end loop;
end
$$;
