-- READ ONLY. No row data, decrypted secrets, function bodies or scheduler commands.
-- Run through a controlled DB connection; output contains schema metadata only.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';
SELECT table_schema,table_name,column_name,data_type,is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
('articles','videos','video_generation_jobs','news_sources','video_story_reservations',
 'video_visual_reservations','video_broll_reservations','video_delivery_assets','video_delivery_outbox')
ORDER BY table_name,ordinal_position;
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS argument_types,
 pg_get_function_result(p.oid) AS result_type,p.prosecdef AS security_definer,
 p.proacl::text AS grants,p.proconfig AS settings
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND (p.proname LIKE '%video%' OR p.proname LIKE '%media_delivery%' OR p.proname LIKE '%render_claim%')
ORDER BY p.proname,argument_types;
-- Do not print index predicates/expressions; they could contain literals.
SELECT n.nspname,c.relname AS table_name,i.relname AS index_name,x.indisunique,x.indisvalid,
 ARRAY(SELECT a.attname FROM unnest(x.indkey) WITH ORDINALITY k(num,ord)
 LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num ORDER BY k.ord) AS columns,
 x.indpred IS NOT NULL AS partial,x.indexprs IS NOT NULL AS expression_index
FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND (c.relname LIKE 'video%' OR c.relname IN ('articles','news_sources')) ORDER BY c.relname,i.relname;
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text AS grants
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'video%' ORDER BY c.relname;
SELECT schemaname,tablename,policyname,permissive,roles,cmd,
 qual IS NOT NULL AS has_using,with_check IS NOT NULL AS has_check
FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'video%' ORDER BY tablename,policyname;
SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name LIKE 'video%' ORDER BY table_name,grantee,privilege_type;
-- cron.job contains command strings that may carry secrets; deliberately do not select them.
SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='cron') AS cron_schema_present;
ROLLBACK;
-- POLICY EXPRESSIONS, RPC BODIES, cron active flags, actual legacy worker state and storage
-- bucket policies still need authorized secure inspection. This audit is not complete evidence.
