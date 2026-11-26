-- Minimal PostgreSQL 17 contract fixture for isolated queue CI tests.
-- This is not a production schema dump and must only run in a disposable database.
begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end;
$roles$;

create schema if not exists auth;
create schema if not exists extensions;
grant usage on schema auth, extensions to public;

create type public.app_role as enum (
  'admin','chief_editor','desk_editor','staff_reporter'
);

create table auth.users (
  id uuid primary key,
  aud text,
  role text,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'staff_reporter'
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to public;

create or replace function public.test_create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id,role)
  values (new.id,'staff_reporter'::public.app_role);
  return new;
end;
$$;

create trigger test_auth_user_profile
after insert on auth.users
for each row execute function public.test_create_profile();

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  content text
);

create table public.videos (
  id uuid primary key,
  title_bn text not null
);

create table public.video_generation_jobs (
  id uuid primary key,
  video_id uuid references public.videos(id) on delete set null,
  title text not null,
  status text not null check (
    status in ('queued','scripting','rendering','needs_review','publishing','published','rejected','failed','cancelled')
  ),
  claimed_by text,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now()
);

create table public.video_generation_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  kind text not null
);

create table public.video_generation_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null
);

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.approve_video_generation(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = auth.uid();

  if v_role not in (
    'desk_editor'::public.app_role,
    'chief_editor'::public.app_role,
    'admin'::public.app_role
  ) then
    raise exception 'insufficient_permission' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.video_generation_jobs j
    where j.id=p_job
      and j.status='needs_review'
      and j.video_id is not null
  ) then
    raise exception 'video_not_reviewable' using errcode='42501';
  end if;

  update public.video_generation_jobs
  set status='publishing'
  where id=p_job;
end;
$$;

grant execute on function public.approve_video_generation(uuid) to authenticated;
grant select on public.profiles to authenticated;

commit;
