-- Backfill script on the queued Agnes job from article body
update public.agnes_video_jobs j
set
  script_text = left(coalesce(a.title_bn, '') || '\u0964 ' || coalesce(a.content_bn, ''), 1200),
  payload = jsonb_build_object(
    'script', left(coalesce(a.title_bn, '') || '\u0964 ' || coalesce(a.content_bn, ''), 1200),
    'source', 'manual_backfill'
  ),
  updated_at = now()
from public.articles a
where j.id = '7067647f-f392-48d9-b189-a6cd4a78255d'
  and a.id = j.article_id
returning j.id, j.status, left(j.script_text, 80) as script_preview;

select id, status, article_id, left(coalesce(script_text, ''), 80) as script_preview, created_at
from public.agnes_video_jobs
where id = '7067647f-f392-48d9-b189-a6cd4a78255d';
