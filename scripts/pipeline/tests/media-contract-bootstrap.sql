-- TEST DATABASE ONLY. Minimal Nov-9 schema fixture, never run on production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE public.articles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title_bn text NOT NULL DEFAULT '',title_en text,
 content_bn text,category text,thumbnail_url text,status text,published_at timestamptz,
 updated_at timestamptz DEFAULT now(),video_generated boolean DEFAULT false,
 video_generated_at timestamptz,video_id text,human_verified boolean DEFAULT false,
 verification_status text DEFAULT 'pending',source_published_at timestamptz
);
