-- BVAI additive video-pipeline reconciliation.
-- Safe to replay: existing newsroom tables and editorial rows are preserved.
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS title_bn text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS title_en text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description_bn text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category_key text NOT NULL DEFAULT 'national',
  ADD COLUMN IF NOT EXISTS thumbnail_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS duration_sec integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.videos ALTER COLUMN video_url SET DEFAULT '';
ALTER TABLE public.videos DROP CONSTRAINT IF EXISTS videos_status_check;
ALTER TABLE public.videos ADD CONSTRAINT videos_status_check CHECK (status IN ('draft','needs_review','published','rejected'));
DROP POLICY IF EXISTS public_read_videos ON public.videos;
CREATE POLICY public_read_videos ON public.videos FOR SELECT TO anon, authenticated USING (status='published');

CREATE TABLE IF NOT EXISTS public.video_generation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
 video_id uuid REFERENCES public.videos(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','needs_review','completed','failed','cancelled')),
 render_path text,
 attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
 error_message text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_generation_jobs_article_idx ON public.video_generation_jobs(article_id,created_at DESC);
CREATE INDEX IF NOT EXISTS video_generation_jobs_status_idx ON public.video_generation_jobs(status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS video_generation_jobs_one_active_per_article
 ON public.video_generation_jobs(article_id)
 WHERE status IN ('queued','processing','needs_review');

CREATE TABLE IF NOT EXISTS public.video_generation_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES public.video_generation_jobs(id) ON DELETE CASCADE,
 kind text NOT NULL,
 provider text NOT NULL,
 external_id text,
 url text,
 license text,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_generation_assets_job_idx ON public.video_generation_assets(job_id,created_at DESC);

ALTER TABLE public.video_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_generation_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS video_jobs_service_role_all ON public.video_generation_jobs;
CREATE POLICY video_jobs_service_role_all ON public.video_generation_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS video_assets_service_role_all ON public.video_generation_assets;
CREATE POLICY video_assets_service_role_all ON public.video_generation_assets FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.video_generation_jobs,public.video_generation_assets TO service_role;
REVOKE ALL ON public.video_generation_jobs,public.video_generation_assets FROM anon,authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('reels','reels',false,104857600,ARRAY['video/mp4']::text[])
ON CONFLICT (id) DO NOTHING;
