-- Agnes video pipeline control plane (idempotent up-migration)
create extension if not exists pgcrypto;

create table if not exists public.agnes_video_jobs (
  id                 uuid primary key default gen_random_uuid(),
  article_id         uuid not null,
  claim_token        uuid not null default gen_random_uuid(),
  status             text not null default 'queued'
                     check (status in ('queued','claimed','running','needs_review','approved','delivering','delivered','failed','cancelled')),
  payload            jsonb not null default '{}'::jsonb,
  worker_id          text,
  lease_expires_at   timestamptz,
  started_at         timestamptz,
  finished_at        timestamptz,
  script_text        text,
  script_hash        text,
  video_sha256       text,
  manifest           jsonb,
  error_message      text,
  attempt_count      int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_agnes_jobs_status_created on public.agnes_video_jobs(status, created_at);
create index if not exists idx_agnes_jobs_lease on public.agnes_video_jobs(lease_expires_at) where status in ('claimed','running');

create table if not exists public.agnes_job_events (
  id          bigint generated always as identity primary key,
  job_id      uuid not null references public.agnes_video_jobs(id) on delete cascade,
  event_type  text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_agnes_events_job on public.agnes_job_events(job_id, created_at desc);

create table if not exists public.render_approvals (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.agnes_video_jobs(id) on delete cascade,
  video_sha256    text not null,
  script_sha256   text not null,
  approved_by     text not null,
  approved_at     timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked         boolean not null default false
);
create index if not exists idx_approvals_job on public.render_approvals(job_id) where revoked = false;

create table if not exists public.delivery_outbox (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.agnes_video_jobs(id) on delete cascade,
  platform      text not null check (platform in ('youtube','facebook','website')),
  status        text not null default 'pending'
                check (status in ('pending','delivering','delivered','failed','dead')),
  attempt_count int not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(job_id, platform)
);

create table if not exists public.delivery_receipts (
  id            uuid primary key default gen_random_uuid(),
  outbox_id     uuid not null references public.delivery_outbox(id) on delete cascade,
  provider      text not null,
  provider_id   text,
  receipt       jsonb not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.delivery_reconciliation (
  id            uuid primary key default gen_random_uuid(),
  outbox_id     uuid not null references public.delivery_outbox(id) on delete cascade,
  status        text not null check (status in ('matched','missing','mismatch')),
  detail        jsonb,
  reconciled_at timestamptz not null default now()
);

create or replace function public.claim_agnes_job(p_worker_id text, p_lease_seconds int default 900)
returns public.agnes_video_jobs
language plpgsql security definer as $$
declare v_job public.agnes_video_jobs;
begin
  update public.agnes_video_jobs
     set status = 'claimed',
         worker_id = p_worker_id,
         started_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt_count = attempt_count + 1,
         updated_at = now()
   where id = (
     select id from public.agnes_video_jobs
      where status = 'queued'
         or (status in ('claimed','running') and lease_expires_at < now())
      order by created_at
      for update skip locked
      limit 1
   )
  returning * into v_job;
  return v_job;
end; $$;

create or replace function public.enforce_daily_quota()
returns trigger language plpgsql as $$
declare
  v_day date := (now() at time zone 'Asia/Dhaka')::date;
  v_count int;
begin
  if new.status = 'delivered' and (old.status is distinct from 'delivered') then
    select count(*) into v_count from public.agnes_video_jobs
     where status = 'delivered'
       and (finished_at at time zone 'Asia/Dhaka')::date = v_day
       and id <> new.id;
    if v_count >= 12 then raise exception 'daily_quota_exceeded'; end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_daily_quota on public.agnes_video_jobs;
create trigger trg_daily_quota before update on public.agnes_video_jobs
  for each row execute function public.enforce_daily_quota();

alter table public.agnes_video_jobs       enable row level security;
alter table public.agnes_job_events       enable row level security;
alter table public.render_approvals        enable row level security;
alter table public.delivery_outbox         enable row level security;
alter table public.delivery_receipts       enable row level security;
alter table public.delivery_reconciliation enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'agnes_video_jobs','agnes_job_events','render_approvals',
    'delivery_outbox','delivery_receipts','delivery_reconciliation'
  ]) loop
    execute format('drop policy if exists service_role_all on public.%I', t);
    execute format('create policy service_role_all on public.%I for all to service_role using (true) with check (true)', t);
  end loop;
end $$;
