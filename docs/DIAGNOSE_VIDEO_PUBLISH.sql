-- Run in Supabase SQL editor (service role / postgres). Read-only diagnostics.

-- 1) Classic pipeline: is a render due right now?
select public.video_job_due() as classic_job_due;

-- 2) Peak windows (Dhaka hour must fall inside an enabled window)
select * from public.video_peak_windows order by start_hour;

-- 3) Recent classic generation jobs
select id, status, article_id, left(coalesce(error_message,''),120) as err, created_at
from public.video_generation_jobs
order by created_at desc limit 15;

-- 4) Classic YouTube outbox (user already saw empty)
select id, platform, status, created_at, updated_at
from public.video_delivery_outbox
order by created_at desc limit 15;

-- 5) Agnes jobs + Agnes delivery outbox (separate tables!)
select id, status, article_id, left(coalesce(error_message,''),120) as err, created_at
from public.agnes_video_jobs
order by created_at desc limit 15;

select id, job_id, platform, status, attempt_count, left(coalesce(last_error,''),120) as err, created_at
from public.delivery_outbox
order by created_at desc limit 15;

-- 6) Why articles may be ineligible for classic video_job_due
select a.id, a.status, length(a.content_bn) as bn_len,
       a.human_verified, a.verification_status,
       a.source_published_at, a.published_at,
       public.video_gate_basis(a.id) as gate_basis,
       exists(select 1 from public.videos v where v.article_id = a.id) as has_video
from public.articles a
where a.status = 'published'
order by coalesce(a.source_published_at, a.published_at) desc nulls last
limit 20;
