alter table public.articles
  add column if not exists is_premium boolean not null default false,
  add column if not exists category_key text not null default 'national',
  add column if not exists thumbnail_url text not null default '',
  add column if not exists featured_image text not null default '',
  add column if not exists excerpt_bn text not null default '',
  add column if not exists title_en text not null default '';
