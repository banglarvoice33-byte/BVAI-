alter table public.social_platforms
  add column if not exists tier text not null default 'secondary',
  add column if not exists enabled boolean not null default false,
  add column if not exists names_verified boolean not null default false,
  add column if not exists required_secrets text[] not null default '{}',
  add column if not exists daily_post_limit integer not null default 10,
  add column if not exists min_gap_minutes integer not null default 30;
