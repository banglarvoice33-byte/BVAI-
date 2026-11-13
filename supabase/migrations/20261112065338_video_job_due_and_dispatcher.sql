-- A. Cheap "is a render due right now?" probe: peak window open, quota left, spacing respected, and a fresh eligible article exists.
create or replace function public.video_job_due()
returns boolean
language plpgsql stable security definer set search_path = ''
as $function$
declare
  hr integer := extract(hour from timezone('Asia/Dhaka', now()))::integer;
  day_start timestamptz := date_trunc('day', timezone('Asia/Dhaka', now())) at time zone 'Asia/Dhaka';
  w record; last_in_window timestamptz; gap interval;
begin
  if not public.video_slot_available(false) then return false; end if;
  select * into w from public.video_peak_windows where enabled and quota > 0 and hr >= start_hour and hr < end_hour order by start_hour limit 1;
  if not found then return false; end if;
  -- Spread the window quota across the window instead of firing every slot at its first minute (20% jitter allowance).
  gap := make_interval(secs => floor(((w.end_hour - w.start_hour) * 3600.0 / w.quota) * 0.8)::integer);
  select max(created_at) into last_in_window from public.video_generation_jobs
   where status <> 'failed' and created_at >= day_start + make_interval(hours => w.start_hour) and created_at < day_start + make_interval(hours => w.end_hour);
  if last_in_window is not null and now() < last_in_window + gap then return false; end if;
  return exists (
    select 1 from public.articles a
     where a.status = 'published' and length(a.content_bn) > 200
       and public.video_gate_basis(a.id) is not null
       and coalesce(a.source_published_at, a.published_at) between now() - interval '24 hours' and now() + interval '5 minutes'
       and not exists (select 1 from public.videos v where v.article_id = a.id)
       and not exists (select 1 from public.video_generation_jobs j where j.article_id = a.id and j.status in ('queued','processing','needs_review'))
       and not exists (select 1 from public.video_generation_jobs j where j.article_id = a.id and j.status = 'failed' and j.created_at > now() - interval '24 hours'
                         and (j.error_message like 'article_too_short_for_video%' or j.error_message like 'duplicate_story_or_script%'))
       and (select count(*) from public.video_generation_jobs j where j.article_id = a.id and j.created_at > now() - interval '24 hours') < 3);
end $function$;
revoke all on function public.video_job_due() from public, anon, authenticated;
grant execute on function public.video_job_due() to service_role;

-- B. Optional dispatcher: starts the GitHub render workflow exactly when a render is due. Inert until the vault holds GITHUB_DISPATCH_TOKEN
--    and deployment_settings holds GITHUB_REPO (owner/name). GitHub's own cron is only a fallback (it is delayed or skipped under load).
create table if not exists public.video_dispatch_state (
  id boolean primary key default true check (id),
  last_dispatched_at timestamptz,
  last_request_id bigint,
  last_note text
);
alter table public.video_dispatch_state enable row level security;
revoke all on public.video_dispatch_state from public, anon, authenticated;
grant all on public.video_dispatch_state to service_role;
insert into public.video_dispatch_state(id) values (true) on conflict do nothing;

create or replace function public.dispatch_video_render()
returns bigint
language plpgsql security definer set search_path = ''
as $function$
declare last_at timestamptz; tok text; repo text; ref text; req bigint;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(73920515) then return null; end if;
  select last_dispatched_at into last_at from public.video_dispatch_state where id for update;
  if last_at is not null and now() < last_at + interval '20 minutes' then return null; end if;
  if not public.video_job_due() then return null; end if;
  select ds.decrypted_secret into tok from public.api_vault v join vault.decrypted_secrets ds on ds.id = v.key_encrypted
   where v.service_name = 'GITHUB_DISPATCH_TOKEN' and v.environment = 'prod' and v.is_active limit 1;
  select value into repo from public.deployment_settings where key = 'GITHUB_REPO';
  select coalesce(nullif(value, ''), 'main') into ref from public.deployment_settings where key = 'GITHUB_REF';
  if coalesce(tok, '') = '' or coalesce(repo, '') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' then
    update public.video_dispatch_state set last_note = 'dispatcher inactive: GITHUB_DISPATCH_TOKEN or GITHUB_REPO missing' where id;
    return null;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/' || repo || '/actions/workflows/video-render.yml/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || tok, 'Accept', 'application/vnd.github+json', 'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'bvai-pg-net', 'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', coalesce(ref, 'main')),
    timeout_milliseconds := 15000) into req;
  update public.video_dispatch_state set last_dispatched_at = now(), last_request_id = req, last_note = 'dispatched' where id;
  return req;
end $function$;
revoke all on function public.dispatch_video_render() from public, anon, authenticated;
grant execute on function public.dispatch_video_render() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bvai-video-dispatch') then perform cron.unschedule('bvai-video-dispatch'); end if;
  perform cron.schedule('bvai-video-dispatch', '*/5 * * * *', 'select public.dispatch_video_render()');
end $$;
