create table if not exists public.ai_gateway_daily_budget (
 task text not null,
 day_utc date not null,
 requests integer not null check (requests >= 0),
 primary key (task, day_utc)
);
alter table public.ai_gateway_daily_budget enable row level security;
revoke all on public.ai_gateway_daily_budget from public, anon, authenticated;
grant select, delete on public.ai_gateway_daily_budget to service_role;
create or replace function public.reserve_ai_gateway_request(p_task text, p_limit integer)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_requests integer;
begin
 if p_task is null or p_task !~ '^[a-z][a-z0-9_-]{1,40}$' or p_limit is null or p_limit < 1 or p_limit > 10000 then return false; end if;
 insert into public.ai_gateway_daily_budget(task, day_utc, requests)
 values (p_task, timezone('UTC', now())::date, 1)
 on conflict (task, day_utc) do update
 set requests = ai_gateway_daily_budget.requests + 1
 where ai_gateway_daily_budget.requests < p_limit
 returning requests into v_requests;
 return v_requests is not null;
end; $$;
revoke all on function public.reserve_ai_gateway_request(text,integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_gateway_request(text,integer) to service_role;
