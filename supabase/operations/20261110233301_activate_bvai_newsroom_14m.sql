-- OPERATION (not a migration): activated the 14-minute article scheduler on BVAI at 2026-11-10 23:33:01 UTC.
-- The cron ticks every minute; public.tick_newsroom_14m() enqueues one POST to SITE_URL/api/newsroom/cron-trigger
-- only if >=14 minutes have passed since the last request (newsroom_cadence_state).
-- First tick 23:34:00 UTC -> HTTP 200 ok:true (5 sources processed, 0 published: quality gates held all 5 as pending).
select cron.alter_job(job_id := (select jobid from cron.job where jobname='bvai-newsroom-14m'), active := true);
-- ROLLBACK (stops new article requests; does not undo anything already ingested):
-- select cron.alter_job(job_id := (select jobid from cron.job where jobname='bvai-newsroom-14m'), active := false);
