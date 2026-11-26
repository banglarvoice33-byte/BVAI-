-- Paste into Supabase SQL Editor and Run.

select public.video_job_due() as classic_due;
select extract(hour from timezone('Asia/Dhaka', now())) as dhaka_hour;
select * from public.video_peak_windows order by start_hour;

select
  a.id,
  left(a.title_bn, 60) as title,
  length(a.content_bn) as bn_len,
  a.human_verified,
  a.verification_status,
  public.video_gate_basis(a.id) as gate_basis,
  coalesce(a.source_published_at, a.published_at) as source_ts,
  exists(select 1 from public.videos v where v.article_id = a.id) as has_video,
  (select count(*) from public.video_generation_jobs j where j.article_id = a.id and j.created_at > now() - interval '24 hours') as jobs_24h
from public.articles a
where a.status = 'published'
order by coalesce(a.source_published_at, a.published_at) desc nulls last
limit 20;

select id, status, article_id, left(coalesce(error_message,''), 100) as err, created_at
from public.video_generation_jobs
order by created_at desc limit 10;

select id, status, article_id, created_at from public.agnes_video_jobs order by created_at desc limit 10;

select count(*) as classic_outbox from public.video_delivery_outbox;
select count(*) as agnes_outbox from public.delivery_outbox;
