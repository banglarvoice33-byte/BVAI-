-- Run via audit.py backend for TLS, timeout and output guards.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS history_exists \gset
\if :history_exists
SELECT json_build_object('history_present', true, 'versions',
  (SELECT coalesce(json_agg(version ORDER BY version), '[]'::json)
   FROM supabase_migrations.schema_migrations));
\else
SELECT json_build_object('history_present', false, 'versions', '[]'::json);
\endif
SELECT json_build_object('database', current_database(), 'role', current_user,
 'rls_tables', (SELECT coalesce(json_agg(x), '[]'::json) FROM
 (SELECT n.nspname AS schema, c.relname AS table_name,
         c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p') AND n.nspname='public'
  ORDER BY c.relname) x));
ROLLBACK;
