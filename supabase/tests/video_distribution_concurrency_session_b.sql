-- Session B: run while Session A is sleeping.
begin;
set local app.video_distribution_v1 = 'true';
set local role service_role;

select id, claimed_by, status
from public.claim_video_distribution_jobs('concurrency-session-b', 1, 120);

commit;
