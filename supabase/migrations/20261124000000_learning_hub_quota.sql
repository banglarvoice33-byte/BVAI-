-- No questions, answers or IP addresses are stored. One row per account;
-- an atomic conditional upsert prevents parallel requests exceeding the cap.
create table if not exists public.learning_hub_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  quota_day date not null,
  used smallint not null check (used between 1 and 10)
);
alter table public.learning_hub_usage enable row level security;
revoke all on public.learning_hub_usage from public, anon, authenticated;

create or replace function public.consume_learning_hub_question(p_user_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  today date := (statement_timestamp() at time zone 'Asia/Dhaka')::date;
  used_now integer;
begin
  insert into public.learning_hub_usage as q (user_id, quota_day, used)
    values (p_user_id, today, 1)
  on conflict (user_id) do update
    set quota_day = excluded.quota_day,
        used = case when q.quota_day < excluded.quota_day then 1 else q.used + 1 end
    where q.quota_day < excluded.quota_day or (q.quota_day = excluded.quota_day and q.used < 10)
  returning used into used_now;
  -- -1 means refused; 0 means the tenth question was accepted.
  return coalesce(10 - used_now, -1);
end;
$$;
revoke execute on function public.consume_learning_hub_question(uuid) from public, anon, authenticated;
grant execute on function public.consume_learning_hub_question(uuid) to service_role;
notify pgrst, 'reload schema';
