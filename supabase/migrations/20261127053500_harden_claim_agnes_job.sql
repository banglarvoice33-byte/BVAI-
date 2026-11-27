-- Restrict claim_agnes_job to the server-side worker role and pin search_path.
revoke execute on function public.claim_agnes_job(text, integer) from public;
revoke execute on function public.claim_agnes_job(text, integer) from anon, authenticated;
grant  execute on function public.claim_agnes_job(text, integer) to service_role;
alter function public.claim_agnes_job(text, integer) set search_path = '';
