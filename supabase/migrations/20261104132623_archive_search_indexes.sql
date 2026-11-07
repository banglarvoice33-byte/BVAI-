-- Archive search indexes for the public newsroom search page.
-- Applied to Supabase project YOUR-PROJECT-REF.
create extension if not exists pg_trgm;

create index if not exists articles_published_date_search_idx
  on public.articles (published_at desc, category)
  where status = 'published' and published_at is not null;

create index if not exists articles_title_bn_trgm_idx
  on public.articles using gin (title_bn gin_trgm_ops);

create index if not exists articles_title_en_trgm_idx
  on public.articles using gin (title_en gin_trgm_ops);

create index if not exists articles_excerpt_bn_trgm_idx
  on public.articles using gin (excerpt_bn gin_trgm_ops);

create index if not exists articles_source_name_trgm_idx
  on public.articles using gin (source_name gin_trgm_ops);
