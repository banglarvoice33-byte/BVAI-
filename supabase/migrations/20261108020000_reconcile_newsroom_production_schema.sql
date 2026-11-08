-- Reconcile the production schema with the live newsroom API and worker contracts.
-- Additive and idempotent. Does not publish content or activate a scheduler.

BEGIN;

CREATE TABLE IF NOT EXISTS public.news_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  feed_url text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  kill_switch boolean NOT NULL DEFAULT false,
  interval_minutes integer NOT NULL DEFAULT 15 CHECK (interval_minutes > 0),
  licence_note text NOT NULL DEFAULT 'Public RSS',
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_probe_at timestamptz,
  last_probe_status text CHECK (last_probe_status IS NULL OR last_probe_status IN ('ok','error','disabled','skipped')),
  last_probe_http_status integer,
  last_probe_items integer,
  last_probe_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.news_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "news sources service manage" ON public.news_sources;
CREATE POLICY "news sources service manage" ON public.news_sources
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.news_sources FROM anon, authenticated;
GRANT ALL ON public.news_sources TO service_role;

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS excerpt_bn text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category_key text NOT NULL DEFAULT 'national',
  ADD COLUMN IF NOT EXISTS editorial_status text NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS human_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_language text NOT NULL DEFAULT 'bn',
  ADD COLUMN IF NOT EXISTS source_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS canonical_url text,
  ADD COLUMN IF NOT EXISTS source_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS fact_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS context_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS featured_image text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS image_alt_bn text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS image_credit text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS image_license text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS image_is_representational boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_source_url text,
  ADD COLUMN IF NOT EXISTS image_relevance_score integer,
  ADD COLUMN IF NOT EXISTS image_rights_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS image_license_url text,
  ADD COLUMN IF NOT EXISTS image_rights_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_fallback boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ai_model text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_confidence numeric,
  ADD COLUMN IF NOT EXISTS video_id text,
  ADD COLUMN IF NOT EXISTS video_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS content_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_breaking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'original';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.articles'::regclass
      AND conname = 'articles_source_id_fkey'
  ) THEN
    ALTER TABLE public.articles
      ADD CONSTRAINT articles_source_id_fkey
      FOREIGN KEY (source_id) REFERENCES public.news_sources(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.articles DROP CONSTRAINT IF EXISTS articles_status_check;
ALTER TABLE public.articles ADD CONSTRAINT articles_status_check
  CHECK (status IN ('draft','scheduled','published','archived','pending'));

UPDATE public.articles SET slug = id::text WHERE slug IS NULL OR btrim(slug) = '';
CREATE OR REPLACE FUNCTION public.set_article_slug_from_id()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := NEW.id::text;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS articles_set_slug_from_id ON public.articles;
CREATE TRIGGER articles_set_slug_from_id
  BEFORE INSERT ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.set_article_slug_from_id();

CREATE UNIQUE INDEX IF NOT EXISTS articles_slug_uidx
  ON public.articles(slug) WHERE slug IS NOT NULL AND slug <> '';
CREATE UNIQUE INDEX IF NOT EXISTS articles_source_url_uidx
  ON public.articles(source_url) WHERE source_url IS NOT NULL AND source_url <> '';
CREATE UNIQUE INDEX IF NOT EXISTS articles_content_hash_uidx
  ON public.articles(content_hash) WHERE content_hash IS NOT NULL AND content_hash <> '';
CREATE INDEX IF NOT EXISTS articles_public_feed_idx
  ON public.articles(status, published_at DESC);

CREATE TABLE IF NOT EXISTS public.news_ingest_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL DEFAULT '',
  source_url text NOT NULL UNIQUE,
  source_published_at timestamptz,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  image_url text,
  category_hint text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','skipped','published','pending_review','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at timestamptz,
  locked_by text,
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_ingest_queue_status_created_idx
  ON public.news_ingest_queue(status, created_at DESC);
ALTER TABLE public.news_ingest_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny client news_ingest_queue" ON public.news_ingest_queue;
CREATE POLICY "deny client news_ingest_queue" ON public.news_ingest_queue
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.news_ingest_queue FROM anon, authenticated;
GRANT ALL ON public.news_ingest_queue TO service_role;

CREATE TABLE IF NOT EXISTS public.news_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  fetched integer NOT NULL DEFAULT 0,
  queued integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  published integer NOT NULL DEFAULT 0,
  pending_review integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_pipeline_runs_stage_created_idx
  ON public.news_pipeline_runs(stage, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS news_pipeline_runs_active_cron_uidx
  ON public.news_pipeline_runs(stage)
  WHERE stage='cron' AND status='running' AND completed_at IS NULL;
ALTER TABLE public.news_pipeline_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny client news_pipeline_runs" ON public.news_pipeline_runs;
CREATE POLICY "deny client news_pipeline_runs" ON public.news_pipeline_runs
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.news_pipeline_runs FROM anon, authenticated;
GRANT ALL ON public.news_pipeline_runs TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_news_pipeline_lock(p_stale_before timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE run_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('banglarvoice:news-cron', 0));
  UPDATE public.news_pipeline_runs
  SET status='failed', error_message='stale_lock',
      completed_at=COALESCE(completed_at, now())
  WHERE stage='cron' AND status='running' AND completed_at IS NULL
    AND created_at <= p_stale_before;
  IF EXISTS (
    SELECT 1 FROM public.news_pipeline_runs
    WHERE stage='cron' AND status='running' AND completed_at IS NULL
  ) THEN RETURN NULL; END IF;
  INSERT INTO public.news_pipeline_runs(stage,status,details)
  VALUES('cron','running',jsonb_build_object('locked_by','cron','sources','{}'::jsonb))
  RETURNING id INTO run_id;
  RETURN run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.acquire_news_pipeline_lock(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_news_pipeline_lock(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.news_pipeline_last_success()
RETURNS timestamptz LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(completed_at, created_at)
  FROM public.news_pipeline_runs
  WHERE status='success'
  ORDER BY created_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.news_pipeline_last_success() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.news_pipeline_last_success() TO anon, authenticated, service_role;

INSERT INTO public.news_sources(name,feed_url,enabled,kill_switch,interval_minutes,licence_note)
VALUES
  ('BBC Bangla','https://feeds.bbci.co.uk/bengali/rss.xml',true,false,15,'Public RSS; AI rewrite and editorial quality gate required'),
  ('BBC World','https://feeds.bbci.co.uk/news/world/rss.xml',true,false,15,'Public RSS; AI rewrite and editorial quality gate required'),
  ('Prothom Alo','https://www.prothomalo.com/feed/',true,false,15,'Public RSS; AI rewrite and editorial quality gate required'),
  ('Al Jazeera','https://www.aljazeera.com/xml/rss/all.xml',true,false,15,'Public RSS; AI rewrite and editorial quality gate required'),
  ('DW World','https://rss.dw.com/rdf/rss-en-world',true,false,15,'Public RSS; AI rewrite and editorial quality gate required')
ON CONFLICT(feed_url) DO NOTHING;

COMMIT;
