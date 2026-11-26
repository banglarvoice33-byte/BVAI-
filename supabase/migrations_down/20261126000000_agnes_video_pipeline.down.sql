drop trigger if exists trg_daily_quota on public.agnes_video_jobs;
drop function if exists public.enforce_daily_quota();
drop function if exists public.claim_agnes_job(text, int);
drop table if exists public.delivery_reconciliation;
drop table if exists public.delivery_receipts;
drop table if exists public.delivery_outbox;
drop table if exists public.render_approvals;
drop table if exists public.agnes_job_events;
drop table if exists public.agnes_video_jobs;
