alter table public.news_ingest_queue
  add column if not exists source_registry_id uuid,
  add column if not exists article_id uuid;

alter table public.field_reports
  add column if not exists ai_duplicate_of uuid;

alter table public.live_sessions
  add column if not exists started_by uuid;

alter table public.articles
  add column if not exists author_id uuid;
