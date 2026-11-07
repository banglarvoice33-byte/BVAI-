-- Run as postgres after both sessions have committed.
begin;
delete from public.video_distribution_jobs
where id=md5('pgtap-concurrency-job-fixture')::uuid;
delete from public.videos
where id=md5('pgtap-concurrency-video-fixture')::uuid;
commit;
