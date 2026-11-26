-- Disposable PostgreSQL/Supabase test database only.
-- Creates one isolated queue row for the two-session SKIP LOCKED test.
-- Run once as postgres after applying the queue migration.
begin;

do $guard$
begin
  if exists (
    select 1 from public.video_distribution_jobs
    where id=md5('pgtap-concurrency-job-fixture')::uuid
       or idempotency_key='pgtap-concurrency-fixture-5201'
  ) or exists (
    select 1 from public.videos
    where id=md5('pgtap-concurrency-video-fixture')::uuid
  ) then
    raise exception 'concurrency_fixture_id_collision';
  end if;
end;
$guard$;

insert into public.videos(id,title_bn)
values (
  md5('pgtap-concurrency-video-fixture')::uuid,
  'Disposable queue concurrency fixture'
);

insert into public.video_distribution_jobs(
  id,video_id,platform,status,attempt_count,max_attempts,next_attempt_at,
  idempotency_key,payload
)
values (
  md5('pgtap-concurrency-job-fixture')::uuid,
  md5('pgtap-concurrency-video-fixture')::uuid,
  'facebook','queued',0,3,clock_timestamp(),
  'pgtap-concurrency-fixture-5201','{}'::jsonb
);

commit;

select id, status, idempotency_key
from public.video_distribution_jobs
where id=md5('pgtap-concurrency-job-fixture')::uuid;
