-- Additive newsletter worker hardening. The worker stays inert by default:
-- newsletter_worker_config.enabled=false and the Edge Function also requires
-- NEWSLETTER_SEND_ENABLED=true. This migration is not applied automatically.

create table if not exists public.newsletter_delivery_receipts (
  source_msg_id bigint primary key check (source_msg_id > 0),
  provider_message_id text not null check (length(provider_message_id) between 1 and 256),
  delivered_at timestamptz not null default now()
);

alter table public.newsletter_delivery_receipts enable row level security;
revoke all on table public.newsletter_delivery_receipts from public, anon, authenticated, service_role;

create table if not exists public.newsletter_dead_letters (
  source_msg_id bigint primary key check (source_msg_id > 0),
  failure_code text not null check (failure_code ~ '^[a-z0-9_]{1,64}$'),
  attempt_count integer not null check (attempt_count between 1 and 100),
  created_at timestamptz not null default now()
);

alter table public.newsletter_dead_letters enable row level security;
revoke all on table public.newsletter_dead_letters from public, anon, authenticated, service_role;

create table if not exists public.newsletter_worker_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.newsletter_worker_config enable row level security;
revoke all on table public.newsletter_worker_config from public, anon, authenticated, service_role;
insert into public.newsletter_worker_config(singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;

create or replace function public.complete_newsletter_delivery(
  p_msg_id bigint,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_existing_provider_id text;
begin
  if p_msg_id is null or p_msg_id <= 0 then
    raise exception 'invalid_newsletter_message_id';
  end if;
  if p_provider_message_id is null or length(p_provider_message_id) < 1 or length(p_provider_message_id) > 256 then
    raise exception 'invalid_provider_message_id';
  end if;

  insert into public.newsletter_delivery_receipts(source_msg_id, provider_message_id)
  values (p_msg_id, p_provider_message_id)
  on conflict (source_msg_id) do nothing;

  select r.provider_message_id into v_existing_provider_id
  from public.newsletter_delivery_receipts r
  where r.source_msg_id = p_msg_id;
  if v_existing_provider_id is distinct from p_provider_message_id then
    raise exception 'newsletter_delivery_conflict';
  end if;

  -- Delete successful queue messages instead of archiving their email addresses.
  -- The receipt and queue acknowledgement commit or roll back together.
  perform pgmq.delete('newsletter_queue', p_msg_id);
  return true;
end;
$$;

create or replace function public.dead_letter_newsletter_message(
  p_msg_id bigint,
  p_failure_code text,
  p_attempt_count integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_inserted integer;
begin
  if p_msg_id is null or p_msg_id <= 0 then
    raise exception 'invalid_newsletter_message_id';
  end if;
  if p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'invalid_newsletter_failure_code';
  end if;
  if p_attempt_count is null or p_attempt_count < 1 or p_attempt_count > 100 then
    raise exception 'invalid_newsletter_attempt_count';
  end if;

  insert into public.newsletter_dead_letters(source_msg_id, failure_code, attempt_count)
  values (p_msg_id, p_failure_code, p_attempt_count)
  on conflict (source_msg_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    -- Preserve the failed payload in PGMQ's archive for restricted operator review.
    perform pgmq.archive('newsletter_queue', p_msg_id);
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.complete_newsletter_delivery(bigint, text) from public, anon, authenticated;
revoke all on function public.dead_letter_newsletter_message(bigint, text, integer) from public, anon, authenticated;
grant execute on function public.complete_newsletter_delivery(bigint, text) to service_role;
grant execute on function public.dead_letter_newsletter_message(bigint, text, integer) to service_role;

create or replace function public.dispatch_newsletter_worker()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, net, vault
as $$
declare
  v_enabled boolean;
  v_gateway_key text;
  v_worker_secret text;
  v_request_id bigint;
begin
  select c.enabled into v_enabled
  from public.newsletter_worker_config c
  where c.singleton is true;
  if coalesce(v_enabled, false) is not true then
    return null;
  end if;

  select ds.decrypted_secret into v_gateway_key
  from vault.decrypted_secrets ds
  join public.api_vault v on v.key_encrypted = ds.id
  where v.service_name = 'NEWSLETTER_EDGE_GATEWAY_KEY'
    and v.environment = 'prod'
    and v.is_active = true
  limit 1;

  select ds.decrypted_secret into v_worker_secret
  from vault.decrypted_secrets ds
  join public.api_vault v on v.key_encrypted = ds.id
  where v.service_name = 'NEWSLETTER_WORKER_SECRET'
    and v.environment = 'prod'
    and v.is_active = true
  limit 1;

  -- Missing secrets are a safe no-op. Never send a service-role JWT through pg_net.
  if coalesce(v_gateway_key, '') = '' or coalesce(v_worker_secret, '') = '' then
    return null;
  end if;

  select net.http_post(
    url := (public.deployment_setting('SUPABASE_URL') || '/functions/v1/send-newsletter'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_gateway_key,
      'x-worker-secret', v_worker_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.dispatch_newsletter_worker() from public, anon, authenticated, service_role;
grant execute on function public.dispatch_newsletter_worker() to postgres;

-- The cron job performs no HTTP call until the database flag is explicitly enabled
-- and both server-side Vault entries are present. The Edge Function has an independent OFF-by-default gate.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'newsletter-worker') then
    perform cron.schedule('newsletter-worker', '* * * * *', 'select public.dispatch_newsletter_worker()');
  end if;
end;
$$;
