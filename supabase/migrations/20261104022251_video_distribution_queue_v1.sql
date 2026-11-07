-- Banglar Voice: isolated video distribution queue v1.
-- PR-1 only. This migration is additive and deliberately does not touch
-- social_posts, articles, newsroom workers, or existing video-generation rows.
-- Feature flag is a PostgreSQL GUC and defaults OFF when unset.

begin;

-- Fail closed if the live schema contract has drifted from the audited one.
do $preflight$
declare
  v_role_type oid;
  v_approval_def text;
  v_role_def text;
begin
  if to_regclass('public.video_generation_jobs') is null
     or to_regclass('public.video_generation_assets') is null
     or to_regclass('public.video_generation_events') is null
     or to_regclass('public.videos') is null
     or to_regclass('public.profiles') is null then
    raise exception 'video_distribution_contract_missing_existing_table';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_generation_jobs'
      and column_name='id' and data_type='uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_generation_jobs'
      and column_name='video_id' and data_type='uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_generation_jobs'
      and column_name='status' and data_type='text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_generation_jobs'
      and column_name='claimed_by' and data_type='text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_generation_jobs'
      and column_name='claimed_at' and data_type='timestamp with time zone'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_generation_jobs'
      and column_name='next_attempt_at' and data_type='timestamp with time zone'
  ) then
    raise exception 'video_generation_jobs_contract_drift';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_generation_assets'
      and column_name='job_id' and data_type='uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_generation_assets'
      and column_name='kind' and data_type='text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_generation_events'
      and column_name='job_id' and data_type='uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='videos'
      and column_name='id' and data_type='uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles'
      and column_name='id' and data_type='uuid'
  ) then
    raise exception 'video_asset_or_video_contract_drift';
  end if;

  select a.atttypid into v_role_type
  from pg_attribute a
  where a.attrelid='public.profiles'::regclass
    and a.attname='role' and a.attnum > 0 and not a.attisdropped;

  if v_role_type is null
     or v_role_type <> to_regtype('public.app_role')::oid
     or to_regprocedure('public.current_app_role()') is null
     or to_regprocedure('public.approve_video_generation(uuid)') is null then
    raise exception 'video_approval_role_contract_missing_or_changed';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.approve_video_generation(uuid)'::regprocedure
  ) into v_approval_def;

  select pg_catalog.pg_get_functiondef(
    'public.current_app_role()'::regprocedure
  ) into v_role_def;

  -- The approval RPC is the source of truth: it moves a linked job from
  -- needs_review to publishing and checks the three editorial roles.
  if position('needs_review' in v_approval_def) = 0
     or position('publishing' in v_approval_def) = 0
     or position('video_id' in lower(v_approval_def)) = 0
     or position('desk_editor' in v_approval_def) = 0
     or position('chief_editor' in v_approval_def) = 0
     or position('admin' in v_approval_def) = 0
     or position('auth.uid()' in v_role_def) = 0 then
    raise exception 'video_approval_rpc_behavior_drift';
  end if;

  if not exists (
    select 1 from pg_enum e
    where e.enumtypid=v_role_type and e.enumlabel='desk_editor'
  ) or not exists (
    select 1 from pg_enum e
    where e.enumtypid=v_role_type and e.enumlabel='chief_editor'
  ) or not exists (
    select 1 from pg_enum e
    where e.enumtypid=v_role_type and e.enumlabel='admin'
  ) then
    raise exception 'video_approval_role_enum_drift';
  end if;
end;
$preflight$;

create table if not exists public.video_distribution_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  platform text not null,
  platform_account_id text,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  lock_expires_at timestamptz,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  provider_job_id text,
  provider_status text,
  result jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint video_distribution_jobs_platform_allowed check (
    platform in ('facebook', 'youtube', 'instagram', 'tiktok', 'x', 'linkedin', 'telegram')
  ),
  constraint video_distribution_jobs_status_allowed check (
    status in ('queued', 'processing', 'succeeded', 'failed', 'retrying', 'dead_letter', 'cancelled')
  ),
  constraint video_distribution_jobs_attempts_valid check (
    attempt_count >= 0 and max_attempts between 1 and 20
  ),
  constraint video_distribution_jobs_payload_object check (
    jsonb_typeof(payload) = 'object'
  ),
  constraint video_distribution_jobs_error_object check (
    error is null or jsonb_typeof(error) = 'object'
  ),
  constraint video_distribution_jobs_result_object check (
    result is null or jsonb_typeof(result) = 'object'
  )
);

-- CREATE TABLE IF NOT EXISTS is intentionally paired with a contract check:
-- it must never silently accept a pre-existing table with an incompatible shape.
do $queue_shape$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_distribution_jobs'
      and column_name='id' and data_type='uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_distribution_jobs'
      and column_name='video_id' and data_type='uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_distribution_jobs'
      and column_name='platform' and data_type='text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_distribution_jobs'
      and column_name='status' and data_type='text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_distribution_jobs'
      and column_name='next_attempt_at' and data_type='timestamp with time zone'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_distribution_jobs'
      and column_name='idempotency_key' and data_type='text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_distribution_jobs'
      and column_name='claimed_by' and data_type='text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='video_distribution_jobs'
      and column_name='lock_expires_at' and data_type='timestamp with time zone'
  ) then
    raise exception 'video_distribution_queue_existing_table_shape_drift';
  end if;
end;
$queue_shape$;

create index if not exists video_distribution_jobs_claim_idx
  on public.video_distribution_jobs(status, next_attempt_at, created_at, id)
  where status in ('queued', 'retrying');

create index if not exists video_distribution_jobs_expired_lock_idx
  on public.video_distribution_jobs(lock_expires_at, created_at, id)
  where status = 'processing';

create index if not exists video_distribution_jobs_video_idx
  on public.video_distribution_jobs(video_id);

create index if not exists video_distribution_jobs_platform_status_idx
  on public.video_distribution_jobs(platform, status);

alter table public.video_distribution_jobs enable row level security;

-- No policies are intentionally created. RLS is default-deny.
-- The table is not directly readable or writable by anon/authenticated.
revoke all on table public.video_distribution_jobs from public, anon, authenticated;
grant select on table public.video_distribution_jobs to service_role; -- writes are RPC-only

-- ---------------------------------------------------------------------------
-- Approval-gated enqueue.
-- approve_video_generation(uuid) changes a valid job to 'publishing', not
-- 'approved'. Require that exact existing transition and a linked video row.
-- Feature flag is OFF when app.video_distribution_v1 is unset or not 'true'.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_video_distribution(
  p_video_id uuid,
  p_platforms text[] default array['facebook']::text[],
  p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
  v_platform text;
  v_account_id text;
  v_inserted integer := 0;
  v_rows integer;
begin
  if coalesce(pg_catalog.current_setting('app.video_distribution_v1', true), 'false') <> 'true' then
    raise exception 'video_distribution_disabled' using errcode = '55000';
  end if;

  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  v_role := public.current_app_role()::text;
  if v_role is null or v_role not in ('admin', 'desk_editor', 'chief_editor') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  if p_video_id is null then
    raise exception 'video_id_required' using errcode = '22023';
  end if;

  if p_platforms is null
     or pg_catalog.cardinality(p_platforms) = 0
     or pg_catalog.cardinality(p_platforms) > 7 then
    raise exception 'invalid_platform_list' using errcode = '22023';
  end if;

  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.pg_column_size(p_payload) > 16384 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  v_account_id := nullif(p_payload ->> 'platform_account_id', '');

  -- This is the real approval state established by approve_video_generation().
  if not exists (
    select 1
    from public.video_generation_jobs j
    join public.videos v on v.id = j.video_id
    where j.video_id = p_video_id
      and j.status = 'publishing'
  ) then
    raise exception 'video_not_approved' using errcode = '42501';
  end if;

  foreach v_platform in array (
    select pg_catalog.array_agg(distinct p order by p)
    from pg_catalog.unnest(p_platforms) as requested(p)
  )
  loop
    insert into public.video_distribution_jobs (
      video_id, platform, platform_account_id, idempotency_key, payload
    )
    values (
      p_video_id,
      v_platform,
      v_account_id,
      v_platform || ':' || p_video_id::text || ':' || coalesce(v_account_id, 'default'),
      p_payload
    )
    on conflict (idempotency_key) do nothing;

    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
  end loop;

  return v_inserted;
end;
$function$;

revoke all on function public.enqueue_video_distribution(uuid, text[], jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_video_distribution(uuid, text[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic claim. SKIP LOCKED permits independent workers to claim disjoint rows.
-- Expired processing leases are reclaimable; exhausted jobs become dead_letter.
-- ---------------------------------------------------------------------------
create or replace function public.claim_video_distribution_jobs(
  p_worker_id text,
  p_limit integer default 3,
  p_lock_seconds integer default 900
)
returns setof public.video_distribution_jobs
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.current_setting('app.video_distribution_v1', true), 'false') <> 'true' then
    raise exception 'video_distribution_disabled' using errcode = '55000';
  end if;

  if p_worker_id is null or pg_catalog.length(pg_catalog.btrim(p_worker_id)) < 3
     or pg_catalog.length(p_worker_id) > 128
     or p_limit is null or p_limit < 1 or p_limit > 50
     or p_lock_seconds is null or p_lock_seconds < 30 or p_lock_seconds > 3600 then
    raise exception 'invalid_claim_arguments' using errcode = '22023';
  end if;

  return query
  with exhausted as (
    update public.video_distribution_jobs j
    set status = 'dead_letter',
        error = coalesce(j.error, '{}'::jsonb) ||
          jsonb_build_object('code', 'MAX_ATTEMPTS_EXHAUSTED', 'at', clock_timestamp()),
        claimed_by = null,
        claimed_at = null,
        lock_expires_at = null,
        updated_at = clock_timestamp()
    where j.status = 'processing'
      and j.lock_expires_at <= clock_timestamp()
      and j.attempt_count >= j.max_attempts
    returning j.id
  ),
  picked as (
    select j.id
    from public.video_distribution_jobs j
    where (
      (j.status in ('queued', 'retrying') and j.next_attempt_at <= clock_timestamp())
      or
      (j.status = 'processing' and j.lock_expires_at <= clock_timestamp()
        and j.attempt_count < j.max_attempts)
    )
    order by j.next_attempt_at, j.created_at, j.id
    limit p_limit
    for update of j skip locked
  )
  update public.video_distribution_jobs j
  set status = 'processing',
      claimed_by = p_worker_id,
      claimed_at = clock_timestamp(),
      lock_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => p_lock_seconds),
      attempt_count = j.attempt_count + 1,
      updated_at = clock_timestamp()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$function$;

revoke all on function public.claim_video_distribution_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_video_distribution_jobs(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Ownership- and lease-verified heartbeat. Expired leases cannot be revived.
-- ---------------------------------------------------------------------------
create or replace function public.heartbeat_video_distribution_job(
  p_job_id uuid,
  p_worker_id text,
  p_lock_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rows integer;
begin
  if p_worker_id is null or pg_catalog.length(pg_catalog.btrim(p_worker_id)) < 3
     or p_lock_seconds is null or p_lock_seconds < 30 or p_lock_seconds > 3600 then
    raise exception 'invalid_heartbeat_arguments' using errcode = '22023';
  end if;

  update public.video_distribution_jobs
  set lock_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => p_lock_seconds),
      updated_at = clock_timestamp()
  where id = p_job_id
    and claimed_by = p_worker_id
    and status = 'processing'
    and lock_expires_at > clock_timestamp();

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$function$;

revoke all on function public.heartbeat_video_distribution_job(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.heartbeat_video_distribution_job(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Atomic completion. Only the current, unexpired owner may complete a claim.
-- ---------------------------------------------------------------------------
create or replace function public.complete_video_distribution_job(
  p_job_id uuid,
  p_worker_id text,
  p_provider_job_id text,
  p_provider_status text,
  p_result jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_worker_id is null or pg_catalog.length(pg_catalog.btrim(p_worker_id)) < 3
     or p_provider_status is null or pg_catalog.length(p_provider_status) > 128
     or p_result is null or pg_catalog.jsonb_typeof(p_result) <> 'object'
     or pg_catalog.pg_column_size(p_result) > 16384 then
    raise exception 'invalid_completion_arguments' using errcode = '22023';
  end if;

  update public.video_distribution_jobs
  set status = 'succeeded',
      provider_job_id = p_provider_job_id,
      provider_status = p_provider_status,
      result = p_result,
      error = null,
      claimed_by = null,
      claimed_at = null,
      lock_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_job_id
    and claimed_by = p_worker_id
    and status = 'processing'
    and lock_expires_at > clock_timestamp();

  if not found then
    raise exception 'job_not_owned_or_lease_expired' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.complete_video_distribution_job(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_video_distribution_job(uuid, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Atomic retry/dead-letter. attempt_count is incremented when a claim is made.
-- ---------------------------------------------------------------------------
create or replace function public.fail_video_distribution_job(
  p_job_id uuid,
  p_worker_id text,
  p_error jsonb,
  p_retry_delay_seconds integer default 60
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.video_distribution_jobs%rowtype;
  v_delay integer;
  v_next_status text;
begin
  if p_worker_id is null or pg_catalog.length(pg_catalog.btrim(p_worker_id)) < 3
     or p_error is null or pg_catalog.jsonb_typeof(p_error) <> 'object'
     or pg_catalog.pg_column_size(p_error) > 8192
     or p_retry_delay_seconds is null or p_retry_delay_seconds < 1
     or p_retry_delay_seconds > 3600 then
    raise exception 'invalid_failure_arguments' using errcode = '22023';
  end if;

  select * into v_job
  from public.video_distribution_jobs
  where id = p_job_id
    and claimed_by = p_worker_id
    and status = 'processing'
    and lock_expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception 'job_not_owned_or_lease_expired' using errcode = '42501';
  end if;

  if v_job.attempt_count >= v_job.max_attempts then
    v_next_status := 'dead_letter';
  else
    v_next_status := 'retrying';
  end if;

  v_delay := least(
    3600,
    (p_retry_delay_seconds::numeric * pg_catalog.power(2, greatest(v_job.attempt_count - 1, 0)))::integer
  );

  update public.video_distribution_jobs
  set status = v_next_status,
      error = p_error,
      next_attempt_at = case
        when v_next_status = 'retrying'
          then clock_timestamp() + pg_catalog.make_interval(secs => v_delay)
        else next_attempt_at
      end,
      claimed_by = null,
      claimed_at = null,
      lock_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_job_id;

  return v_next_status;
end;
$function$;

revoke all on function public.fail_video_distribution_job(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.fail_video_distribution_job(uuid, text, jsonb, integer) to service_role;

commit;
