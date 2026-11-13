-- Articles the renderer rejected for a permanent, content-level reason must not be re-claimed in a loop
-- (it would burn the daily failed-attempt budget and starve other stories).
create or replace function public.claim_reviewed_video_job(p_article_id uuid default null)
returns table(article_id uuid, job_id uuid, claim_token uuid)
language plpgsql security definer set search_path = ''
as $function$
declare chosen uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(73920511);
  if not public.video_slot_available(p_article_id is not null) then return; end if;
  select a.id into chosen from public.articles a
   where a.status = 'published' and length(a.content_bn) > 200
     and public.video_gate_basis(a.id) is not null
     and coalesce(a.source_published_at, a.published_at) between now() - interval '24 hours' and now() + interval '5 minutes'
     and (p_article_id is null or a.id = p_article_id)
     and not exists (select 1 from public.videos v where v.article_id = a.id)
     and not exists (select 1 from public.video_generation_jobs j where j.article_id = a.id and j.status in ('queued','processing','needs_review'))
     and not exists (select 1 from public.video_generation_jobs j where j.article_id = a.id and j.status = 'failed'
                       and j.created_at > now() - interval '24 hours'
                       and (j.error_message like 'article_too_short_for_video%' or j.error_message like 'duplicate_story_or_script%'))
     and (select count(*) from public.video_generation_jobs j where j.article_id = a.id and j.created_at > now() - interval '24 hours') < 3
   order by a.published_at desc nulls last, a.id
   for update of a skip locked
   limit 1;
  if chosen is null then return; end if;
  return query select * from public.claim_video_generation_job(chosen);
end $function$;
revoke all on function public.claim_reviewed_video_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_reviewed_video_job(uuid) to service_role;
