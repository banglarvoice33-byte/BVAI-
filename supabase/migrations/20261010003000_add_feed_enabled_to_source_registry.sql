alter table public.source_registry 
add column if not exists feed_enabled boolean not null default true;
