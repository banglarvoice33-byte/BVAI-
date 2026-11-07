-- A submitted field report (status = pending_review) becomes ONE pending article,
-- so it shows up in the existing Admin app approval queue. Nothing is auto-published.
create unique index if not exists articles_field_report_uidx
  on public.articles (field_report_id)
  where field_report_id is not null;

create or replace function public.create_pending_article_from_field_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_cat  text;
  v_title text;
begin
  if NEW.status is distinct from 'pending_review'::public.report_status then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.status is not distinct from NEW.status then
    return NEW;
  end if;
  if exists (select 1 from public.articles a where a.field_report_id = NEW.id) then
    return NEW;
  end if;

  select nullif(trim(p.full_name), '') into v_name
  from public.profiles p where p.id = NEW.reporter_id;

  select a.category into v_cat
  from public.articles a
  where a.category_key = 'national' and a.category is not null
  limit 1;

  v_title := coalesce(nullif(trim(NEW.title), ''), nullif(left(trim(NEW.description), 80), ''), 'Field report');

  insert into public.articles (
    field_report_id, title_bn, content_bn, excerpt_bn,
    category_key, category,
    status, workflow_status, editorial_status, verification_status, human_verified,
    origin, source_type, source_name, media_type,
    author_id, risk_level, review_reason, is_breaking
  ) values (
    NEW.id, v_title, NEW.description, left(NEW.description, 200),
    'national', coalesce(v_cat, 'national'),
    'pending', 'draft', 'pending_review', 'pending', false,
    'manual', 'editorial', coalesce(v_name, 'Field reporter'), 'none',
    NEW.reporter_id, 'medium', 'field_report', false
  );

  return NEW;
end
$$;

revoke all on function public.create_pending_article_from_field_report() from public, anon, authenticated;

drop trigger if exists trg_field_report_to_pending_article on public.field_reports;
create trigger trg_field_report_to_pending_article
  after insert or update of status on public.field_reports
  for each row execute function public.create_pending_article_from_field_report();
