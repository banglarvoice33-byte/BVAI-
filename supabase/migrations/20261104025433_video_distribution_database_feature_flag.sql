begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists private.video_distribution_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default current_user
);
revoke all on table private.video_distribution_config from public, anon, authenticated, service_role;
insert into private.video_distribution_config(singleton, enabled, updated_by)
values (true, true, 'production_activation_2026-11-04')
on conflict (singleton) do update
set enabled = true, updated_at = now(), updated_by = excluded.updated_by;

create or replace function private.video_distribution_is_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select c.enabled from private.video_distribution_config c where c.singleton = true),
    false
  );
$function$;
revoke all on function private.video_distribution_is_enabled() from public, anon, authenticated, service_role;

do $migration$
declare
  v_old text;
  v_new text;
  v_old_guard text := 'coalesce(pg_catalog.current_setting(''app.video_distribution_v1'',true),''false'')<>''true''';
begin
  select pg_catalog.pg_get_functiondef('public.enqueue_video_distribution(uuid,text[],jsonb)'::regprocedure) into v_old;
  if position(v_old_guard in v_old) = 0 then
    raise exception 'enqueue_feature_flag_guard_not_found';
  end if;
  v_new := replace(v_old, v_old_guard, 'not private.video_distribution_is_enabled()');
  execute v_new;

  select pg_catalog.pg_get_functiondef('public.claim_video_distribution_jobs(text,integer,integer)'::regprocedure) into v_old;
  if position(v_old_guard in v_old) = 0 then
    raise exception 'claim_feature_flag_guard_not_found';
  end if;
  v_new := replace(v_old, v_old_guard, 'not private.video_distribution_is_enabled()');
  execute v_new;
end;
$migration$;
commit;
