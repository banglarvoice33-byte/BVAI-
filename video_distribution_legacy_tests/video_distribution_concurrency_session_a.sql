-- Session A: start this first. Keep the transaction open for 10 seconds.
begin;
set local app.video_distribution_v1 = 'true';
set local role service_role;

select id, claimed_by, status
from public.claim_video_distribution_jobs('concurrency-session-a', 1, 120);

select pg_sleep(10);
commit;
