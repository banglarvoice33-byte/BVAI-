-- 03_schedule_pg_cron.sql
-- Turns the scheduler on: once a minute Postgres calls public.pipeline_tick(), which inserts the
-- jobs that are due (duplicates are impossible because of the unique index).
-- Run ONLY after 01 and 02 passed. Needs the pg_cron extension (free on Supabase).
-- If the first line errors, enable it in Dashboard -> Database -> Extensions -> pg_cron and run again.
create extension if not exists pg_cron;

-- replace any older job with the same name, then schedule it
select cron.unschedule(jobid) from cron.job where jobname = 'bvai-pipeline-tick';
select cron.schedule('bvai-pipeline-tick', '* * * * *', $$select public.pipeline_tick()$$);

-- confirm
select jobid, jobname, schedule, active from cron.job where jobname = 'bvai-pipeline-tick';

-- Look at it a few minutes later:
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
--   select kind, status, scheduled_for from public.pipeline_jobs order by created_at desc limit 10;
-- To switch it off:
--   select cron.unschedule(jobid) from cron.job where jobname = 'bvai-pipeline-tick';
