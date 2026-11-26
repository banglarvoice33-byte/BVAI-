-- Expose per-platform limits on the readiness view; the dispatch code selects them.
do $$
declare d text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'social_platform_readiness'
      and column_name = 'daily_post_limit'
  ) then
    select pg_get_viewdef('public.social_platform_readiness'::regclass, true) into d;
    d := regexp_replace(d, ';\s*$', '');
    execute 'create or replace view public.social_platform_readiness as '
         || 'select v.*, p.daily_post_limit, p.min_gap_minutes from (' || d || ') v '
         || 'join public.social_platforms p on p.platform = v.platform';
  end if;
end $$;
