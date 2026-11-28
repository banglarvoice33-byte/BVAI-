-- 01_pipeline_schema.sql
-- BVAI news/video pipeline schema. Safe to run more than once (idempotent).
-- One parent table (pipeline_jobs) so every child row has a REAL foreign key.
-- RLS is ON and nobody except service_role can read or write by default.
-- NOT executed against a live Postgres by the author: run 00_preflight.sql, then this file,
-- then 02_verify.sql, which asserts the result.

-- ---------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.pipeline_jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('article', 'video', 'social')),
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  origin        text not null default 'schedule' check (origin in ('schedule', 'manual')),
  scheduled_for timestamptz not null,
  payload       jsonb not null default '{}'::jsonb,
  attempt       integer not null default 0 check (attempt >= 0),
  locked_by     text,
  locked_at     timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A scheduled slot can exist only once: this is what prevents duplicate jobs (no Redis lock needed).
create unique index if not exists pipeline_jobs_scheduled_slot_uidx
  on public.pipeline_jobs (kind, scheduled_for) where origin = 'schedule';
create index if not exists pipeline_jobs_queue_idx
  on public.pipeline_jobs (status, scheduled_for) where status in ('queued', 'running');

create table if not exists public.pipeline_agent_runs (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.pipeline_jobs (id) on delete cascade,
  agent_name  text not null,
  attempt     integer not null default 1 check (attempt >= 1),
  status      text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  input       jsonb not null default '{}'::jsonb,
  output      jsonb,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (job_id, agent_name, attempt)
);

create table if not exists public.pipeline_video_candidates (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.pipeline_jobs (id) on delete cascade,
  article_id         uuid not null,
  visual_match_score integer not null default 0 check (visual_match_score between 0 and 100),
  visual_match_status text not null default 'uncertain'
                     check (visual_match_status in ('confirmed', 'uncertain', 'failed')),
  selected           boolean not null default false,
  fallback_rank      integer,
  source_ids         jsonb not null default '[]'::jsonb,
  risks              jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  unique (job_id, article_id)
);

create table if not exists public.pipeline_presenter_runs (
  id                     uuid primary key default gen_random_uuid(),
  job_id                 uuid not null references public.pipeline_jobs (id) on delete cascade,
  story_id               text not null check (story_id in ('A', 'B')),
  presenter_profile_id   text not null,
  voice_id               text not null,
  lip_sync_status        text not null default 'pending' check (lip_sync_status in ('pending', 'completed', 'failed')),
  facial_expression_match text not null default 'pending' check (facial_expression_match in ('pending', 'pass', 'fail')),
  outro_lip_sync_match   text not null default 'pending' check (outro_lip_sync_match in ('pending', 'pass', 'fail')),
  quality_issues         jsonb not null default '[]'::jsonb,
  retry_needed           boolean not null default false,
  ai_disclosure_applied  boolean not null default false,
  created_at             timestamptz not null default now(),
  unique (job_id, story_id)
);

-- Real foreign key to the articles table, only if it exists with a uuid id.
do $$
begin
  if to_regclass('public.articles') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'articles'
                   and column_name = 'id' and data_type = 'uuid')
     and not exists (select 1 from pg_constraint where conname = 'pipeline_video_candidates_article_fk') then
    alter table public.pipeline_video_candidates
      add constraint pipeline_video_candidates_article_fk
      foreign key (article_id) references public.articles (id) on delete cascade;
  else
    raise notice 'articles.id (uuid) not found, or the foreign key already exists: nothing added';
  end if;
end $$;

-- updated_at maintenance
create or replace function public.pipeline_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists pipeline_jobs_touch on public.pipeline_jobs;
create trigger pipeline_jobs_touch
  before update on public.pipeline_jobs
  for each row execute function public.pipeline_touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 2. Security: default deny. Only service_role (your server/worker key) can touch these tables.
--    PostgreSQL docs: with RLS enabled and no policy, a "default deny" applies to normal roles.
-- ---------------------------------------------------------------------------------------------
alter table public.pipeline_jobs             enable row level security;
alter table public.pipeline_agent_runs       enable row level security;
alter table public.pipeline_video_candidates enable row level security;
alter table public.pipeline_presenter_runs   enable row level security;

revoke all on public.pipeline_jobs, public.pipeline_agent_runs,
              public.pipeline_video_candidates, public.pipeline_presenter_runs
  from anon, authenticated;
grant all on public.pipeline_jobs, public.pipeline_agent_runs,
             public.pipeline_video_candidates, public.pipeline_presenter_runs
  to service_role;

-- Optional: read access for editors/admins, created ONLY if public.user_roles(user_id, role) exists.
-- A policy without a TO clause would apply to every role including anon (CREATE POLICY docs),
-- so this one is explicitly "to authenticated". If your role table is different, skip it:
-- your admin pages can read through the server with the service key instead.
do $$
declare
  t text;
begin
  if to_regclass('public.user_roles') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'user_roles' and column_name = 'user_id')
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'user_roles' and column_name = 'role') then
    raise notice 'public.user_roles(user_id, role) not found: editor read policies skipped';
    return;
  end if;
  foreach t in array array['pipeline_jobs', 'pipeline_agent_runs', 'pipeline_video_candidates', 'pipeline_presenter_runs'] loop
    begin
      execute format('grant select on public.%I to authenticated', t);
      execute format('drop policy if exists %I on public.%I', t || '_editor_read', t);
      execute format(
        $f$create policy %I on public.%I for select to authenticated
           using (exists (select 1 from public.user_roles ur
                          where ur.user_id = (select auth.uid()) and ur.role::text in ('editor', 'admin')))$f$,
        t || '_editor_read', t);
    exception when others then
      raise notice 'editor read policy skipped for %: %', t, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Scheduler brain (pure SQL, evaluated in Asia/Dhaka time)
--    Articles : 06:00 then every 14 min until 23:44 (77 slots) + hourly 00:00-05:00 (6 slots) = 83/day
--    Videos   : 12 publish slots; the job is created 60 minutes before its slot
--    Keep in sync with pipeline/schedule.mjs.
-- ---------------------------------------------------------------------------------------------
create or replace function public.pipeline_due_slots(p_now timestamptz default now())
returns table (kind text, scheduled_for timestamptz)
language plpgsql
stable
as $$
declare
  v_now_min   timestamptz := date_trunc('minute', p_now);
  v_local     timestamp := v_now_min at time zone 'Asia/Dhaka';
  v_minutes   integer := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_offset    integer;
  v_target    timestamptz := v_now_min + interval '60 minutes';
  v_target_hm text := to_char(v_target at time zone 'Asia/Dhaka', 'HH24:MI');
  v_video_slots constant text[] := array[
    '07:00', '08:30', '10:00', '12:00', '13:30', '15:00',
    '17:00', '18:30', '20:00', '21:00', '22:00', '23:00'];
begin
  if v_minutes >= 360 then
    v_offset := v_minutes - 360;
    if v_offset % 14 = 0 and v_offset / 14 <= 76 then
      kind := 'article';
      scheduled_for := v_now_min;
      return next;
    end if;
  elsif extract(minute from v_local)::integer = 0 then
    kind := 'article';
    scheduled_for := v_now_min;
    return next;
  end if;

  if v_target_hm = any (v_video_slots) then
    kind := 'video';
    scheduled_for := v_target;
    return next;
  end if;
end
$$;

-- Inserts the jobs that are due. Duplicate slots are ignored by the unique index. Returns rows inserted.
create or replace function public.pipeline_tick(p_now timestamptz default now())
returns integer
language plpgsql
as $$
declare
  v_rows integer;
begin
  insert into public.pipeline_jobs (kind, scheduled_for, origin)
  select d.kind, d.scheduled_for, 'schedule'
  from public.pipeline_due_slots(p_now) d
  on conflict (kind, scheduled_for) where origin = 'schedule' do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end
$$;

-- These functions must NOT be callable through the public REST/RPC API (p_now could inject slots).
revoke all on function public.pipeline_due_slots(timestamptz) from public, anon, authenticated;
revoke all on function public.pipeline_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.pipeline_due_slots(timestamptz), public.pipeline_tick(timestamptz) to service_role;
