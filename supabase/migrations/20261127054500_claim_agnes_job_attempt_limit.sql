create or replace function public.claim_agnes_job(
  p_worker_id text,
  p_lease_seconds integer default 900
)
returns public.agnes_video_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.agnes_video_jobs;
  c_max_attempts constant integer := 5;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker_id_required' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'invalid_lease_seconds' using errcode = '22023';
  end if;

  -- Retire jobs that exhausted their attempts so they never loop forever.
  update public.agnes_video_jobs
     set status = 'failed',
         error_message = coalesce(error_message, 'max_attempts_exceeded'),
         finished_at = now(),
         updated_at = now()
   where status in ('claimed','running')
     and (lease_expires_at is null or lease_expires_at < now())
     and attempt_count >= c_max_attempts;

  update public.agnes_video_jobs
     set status = 'claimed',
         worker_id = p_worker_id,
         started_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt_count = attempt_count + 1,
         updated_at = now()
   where id = (
     select id
       from public.agnes_video_jobs
      where status = 'queued'
         or (status in ('claimed','running')
             and (lease_expires_at is null or lease_expires_at < now())
             and attempt_count < c_max_attempts)
      order by created_at
      for update skip locked
      limit 1
   )
  returning * into v_job;

  return v_job;
end;
$$;

revoke execute on function public.claim_agnes_job(text, integer) from public;
revoke execute on function public.claim_agnes_job(text, integer) from anon, authenticated;
grant  execute on function public.claim_agnes_job(text, integer) to service_role;
