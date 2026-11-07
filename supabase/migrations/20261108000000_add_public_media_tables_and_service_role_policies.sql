-- Forward-only, additive media schema reconciliation for the existing BVAI schema.
-- Existing articles/editorial policies are intentionally preserved.
CREATE TABLE IF NOT EXISTS public.videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  video_url text NOT NULL,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  platform_posted jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS videos_article_id_idx ON public.videos(article_id);
CREATE INDEX IF NOT EXISTS videos_created_at_idx ON public.videos(created_at DESC);
CREATE TABLE IF NOT EXISTS public.epapers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publish_date date NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  pdf_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.epapers ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='videos' AND policyname='public_read_videos') THEN
    CREATE POLICY public_read_videos ON public.videos FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='videos' AND policyname='service_role_manage_videos') THEN
    CREATE POLICY service_role_manage_videos ON public.videos FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='epapers' AND policyname='public_read_epapers') THEN
    CREATE POLICY public_read_epapers ON public.epapers FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='epapers' AND policyname='service_role_manage_epapers') THEN
    CREATE POLICY service_role_manage_epapers ON public.epapers FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='articles' AND policyname='service_role_manage_articles') THEN
    CREATE POLICY service_role_manage_articles ON public.articles FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$$;
GRANT SELECT ON public.videos, public.epapers TO anon, authenticated;
GRANT ALL ON public.videos, public.epapers, public.articles TO service_role;
