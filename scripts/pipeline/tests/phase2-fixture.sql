-- ISOLATED TEST DATABASE ONLY. Stubs of newsroom/ops tables that live in Supabase but not in the CI migration subset.
-- Column names/types mirror the live project (verified read-only against information_schema).
ALTER TABLE public.news_sources ADD COLUMN IF NOT EXISTS name text, ADD COLUMN IF NOT EXISTS interval_minutes integer DEFAULT 14,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer DEFAULT 0, ADD COLUMN IF NOT EXISTS last_probe_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_probe_status text, ADD COLUMN IF NOT EXISTS last_probe_http_status integer,
  ADD COLUMN IF NOT EXISTS last_probe_items integer, ADD COLUMN IF NOT EXISTS last_probe_error text;
CREATE TABLE IF NOT EXISTS public.news_ingest_queue(source_name text,status text,article_id uuid,last_error text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.news_pipeline_runs(stage text,status text,error_message text,completed_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.ai_gateway_usage_events(created_at timestamptz DEFAULT now(),outcome text,input_chars integer DEFAULT 0,output_chars integer DEFAULT 0);
CREATE TABLE IF NOT EXISTS public.tts_usage(month text,chars_used bigint,updated_at timestamptz DEFAULT now());
