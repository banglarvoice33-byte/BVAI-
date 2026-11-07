-- Fresh-install portability; only server/service role can configure origins.
create table if not exists public.deployment_settings (
  key text primary key check (key in ('SITE_URL','SUPABASE_URL')),
  value text not null check (value ~ '^https://[^/[:space:]]+$'),
  updated_at timestamptz not null default now()
);
alter table public.deployment_settings enable row level security;
revoke all on public.deployment_settings from public, anon, authenticated;
grant select, insert, update, delete on public.deployment_settings to service_role;
create or replace function public.deployment_setting(p_key text)
returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v text;
begin
 select value into v from public.deployment_settings where key = p_key;
 if coalesce(v,'') = '' then raise exception 'deployment_setting_missing: %',p_key; end if;
 return rtrim(v,'/');
end; $$;
revoke all on function public.deployment_setting(text) from public, anon, authenticated;
grant execute on function public.deployment_setting(text) to service_role;
