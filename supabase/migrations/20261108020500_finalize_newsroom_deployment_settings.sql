-- Finalize non-secret production settings and indexes for the newsroom schema.
BEGIN;
CREATE INDEX IF NOT EXISTS articles_source_id_idx ON public.articles(source_id);
CREATE INDEX IF NOT EXISTS news_ingest_queue_article_id_idx ON public.news_ingest_queue(article_id);
INSERT INTO public.deployment_settings(key,value)
VALUES
 ('SITE_URL','https://bvai-chi.vercel.app'),
 ('SUPABASE_URL','https://rtejxeamxeycnpcwnseo.supabase.co')
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=now();
COMMIT;