-- Isolated DB fixture ONLY, not a Supabase migration.
CREATE TABLE public.news_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),enabled boolean NOT NULL DEFAULT true,kill_switch boolean NOT NULL DEFAULT false);
ALTER TABLE public.articles ADD COLUMN origin text,ADD COLUMN field_report_id uuid,ADD COLUMN source_id uuid REFERENCES public.news_sources(id),ADD COLUMN source_name text,ADD COLUMN source_url text,ADD COLUMN is_fallback boolean DEFAULT false;
CREATE TABLE public.api_vault(service_name text,environment text,is_active boolean,key_encrypted uuid);
GRANT SELECT ON public.api_vault TO service_role;
CREATE TABLE public.newsroom_cadence_state(id boolean PRIMARY KEY DEFAULT true,last_requested_at timestamptz,last_request_id bigint);
INSERT INTO public.newsroom_cadence_state(id) VALUES(true);
CREATE SCHEMA vault;
CREATE VIEW vault.decrypted_secrets AS SELECT NULL::uuid id,NULL::text decrypted_secret WHERE false;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE FUNCTION public.deployment_setting(text) RETURNS text LANGUAGE sql AS $$ SELECT 'https://news.example'::text $$;
