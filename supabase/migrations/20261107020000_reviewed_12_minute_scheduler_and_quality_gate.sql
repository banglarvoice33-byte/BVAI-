-- Reviewed 12-minute newsroom cadence and conservative publication policy.
-- This migration changes the desired schedule but keeps every job inactive.
-- Enable only through deploy/enable-reviewed-schedules.sql after live checks.
begin;

-- Keep source polling inside the requested 10–14 minute interval.
update public.news_sources
set interval_minutes = 12,
    updated_at = now()
where enabled = true
  and kill_switch = false;

-- Explicit fail-closed policy for every newsroom risk class.
-- No category is auto-published by this migration; an editor must approve.
insert into public.newsroom_verification_policies
  (category, requires_human_review, requires_authority_approval,
   min_independent_sources, min_successful_verifiers, auto_publish_allowed,
   policy_version, active, updated_at)
values
  ('unclassified', true, false, 2, 2, false, 'v2-reviewed-12m', true, now()),
  ('routine',      true, false, 2, 2, false, 'v2-reviewed-12m', true, now()),
  ('sensitive',    true, true,  3, 3, false, 'v2-reviewed-12m', true, now()),
  ('critical',     true, true,  3, 3, false, 'v2-reviewed-12m', true, now())
on conflict (category) do update set
  requires_human_review = excluded.requires_human_review,
  requires_authority_approval = excluded.requires_authority_approval,
  min_independent_sources = excluded.min_independent_sources,
  min_successful_verifiers = excluded.min_successful_verifiers,
  auto_publish_allowed = excluded.auto_publish_allowed,
  policy_version = excluded.policy_version,
  active = excluded.active,
  updated_at = now();

-- Align existing pg_cron jobs if they exist, but preserve fresh-install default-off.
do $$
declare
  v_id bigint;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;

  select jobid into v_id from cron.job where jobname = 'news-ingest-daytime';
  if v_id is not null then
    perform cron.alter_job(v_id, schedule := '*/12 0-17 * * *', active := false);
  end if;

  select jobid into v_id from cron.job where jobname = 'news-ingest-overnight';
  if v_id is not null then
    perform cron.alter_job(v_id, schedule := '*/12 18-23 * * *', active := false);
  end if;
end $$;

commit;
