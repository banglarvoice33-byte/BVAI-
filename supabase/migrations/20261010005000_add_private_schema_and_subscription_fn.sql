create schema if not exists private;

grant usage on schema private to anon, authenticated, service_role;

create or replace function private.has_active_premium_subscription()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;

grant execute on function private.has_active_premium_subscription() to anon, authenticated, service_role;

alter table public.articles
  add column if not exists field_report_id uuid,
  add column if not exists source_id uuid;
