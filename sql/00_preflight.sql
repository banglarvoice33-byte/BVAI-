-- 00_preflight.sql  (READ-ONLY: changes nothing)
-- Run this first in Supabase Dashboard -> SQL Editor and read the result before running 01.
select 'extension available' as check_name, name as item,
       coalesce(installed_version, 'not installed yet') as value
from pg_available_extensions
where name in ('pg_cron', 'pg_net')
union all
select 'table exists', table_name, 'yes'
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'pipeline_jobs', 'pipeline_agent_runs', 'pipeline_video_candidates', 'pipeline_presenter_runs',
    'video_pipeline_jobs', 'article_pipeline_jobs', 'social_distribution_jobs',
    'agent_runs', 'video_candidates', 'presenter_runs')
union all
select 'optional table', x, coalesce(to_regclass(x)::text, 'missing')
from unnest(array['public.articles', 'public.user_roles']) as x
union all
select 'articles.id type', 'public.articles.id',
       coalesce((select data_type from information_schema.columns
                 where table_schema = 'public' and table_name = 'articles' and column_name = 'id'), 'n/a')
union all
select 'server time zone check', 'Asia/Dhaka now', to_char(now() at time zone 'Asia/Dhaka', 'YYYY-MM-DD HH24:MI')
order by 1, 2;
-- How to read it:
--  * "table exists" rows for video_pipeline_jobs / article_pipeline_jobs / social_distribution_jobs /
--    agent_runs / video_candidates / presenter_runs mean an OLD draft migration (v2/v3) was applied.
--    Script 01 does not touch them. See 04_cleanup_old_tables_MANUAL.sql only after checking they are empty.
--  * pg_cron "not installed yet" is fine: script 03 enables it (or enable it in Dashboard -> Database -> Extensions).
--  * public.articles.id should say "uuid" so the candidate table gets a real foreign key; otherwise 01 skips that key.
