-- Harden video approval authorization and add advisor-recommended indexes.
begin;
create or replace function public.approve_video_generation(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_role := public.current_app_role();
  if v_role is null or v_role not in (
    'desk_editor'::public.app_role,
    'chief_editor'::public.app_role,
    'admin'::public.app_role
  ) then
    raise exception 'editorial role required' using errcode = '42501';
  end if;
  update public.video_generation_jobs
     set status = 'publishing',
         next_attempt_at = pg_catalog.now()
   where id = p_job
     and status = 'needs_review'
     and video_id is not null;
  if not found then
    raise exception 'job not found, not reviewable, or video is not linked';
  end if;
end;
$function$;
revoke all on function public.approve_video_generation(uuid) from public, anon;
grant execute on function public.approve_video_generation(uuid) to authenticated, service_role;

create index if not exists article_comments_moderated_by_idx
  on public.article_comments(moderated_by);
create index if not exists video_generation_jobs_created_by_idx
  on public.video_generation_jobs(created_by);
create index if not exists video_generation_jobs_video_id_idx
  on public.video_generation_jobs(video_id);

drop policy if exists article_comments_editor_moderate on public.article_comments;
create policy article_comments_editor_moderate
on public.article_comments
for update to authenticated
using ((select public.current_app_role())::text = any(array['desk_editor','chief_editor','admin']::text[]))
with check (
  ((select public.current_app_role())::text = any(array['desk_editor','chief_editor','admin']::text[]))
  and (
    (status = 'pending' and moderated_at is null and moderated_by is null)
    or
    (status = any(array['approved','rejected']::text[]) and moderated_at is not null and moderated_by = (select auth.uid()))
  )
);
commit;
