-- pgTAP RLS + queue claim tests for agnes_video_jobs.
-- Hosted Supabase: enable pgTAP first in Dashboard → Database → Extensions.
-- Run: psql "$CONN" -f supabase/tests/agnes_rls.sql
-- (CI uses `supabase test db` — Docker required; Android/Termux unsupported.)
begin;

-- pgTAP lives in the "extensions" schema on hosted Supabase.
set local search_path = extensions, public, pg_catalog;

select plan(4);

set local role service_role;
select ok(true, 'service_role can query');

set local role anon;
select is_empty('select * from public.agnes_video_jobs', 'anon sees no rows');

set local role authenticated;
select is_empty('select * from public.agnes_video_jobs', 'authenticated sees no rows');

reset role;
select ok(
  (public.claim_agnes_job('w-test', 60)).id is null,
  'claim_agnes_job returns NULL on empty queue'
);

select * from finish();
rollback;
