-- Newsletter B design (email_queue) - DB te apply kora version
-- Nam + Email, locked_until, worker RPC, dispatch (Edge Function e)
-- Kono sotti email / secret ekhane nai

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','unsubscribed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  template text NOT NULL DEFAULT 'newsletter_welcome',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  msg_id bigint GENERATED ALWAYS AS IDENTITY,
  read_ct int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  provider_message_id text,
  failure_code text,
  attempt_count int NOT NULL DEFAULT 0
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.newsletter_worker_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.newsletter_worker_config ENABLE ROW LEVEL SECURITY;
INSERT INTO public.newsletter_worker_config(singleton, enabled)
VALUES (true, false) ON CONFLICT (singleton) DO NOTHING;

-- NOTE: 7 ta function (subscribe 1-arg + 2-arg, 5 worker RPC, dispatch)
-- DB te agei apply kora ache. Puro function SQL Supabase Dashboard > Database > Functions theke
-- export kore ei file er niche bosale 【entity-GitHub¦canonical_name=GitHub】 + DB 100% soman hobe.
-- Ekhon ei file ta sudhu table + config er proman hisebe thakbe, function gulo DB tei ache.
