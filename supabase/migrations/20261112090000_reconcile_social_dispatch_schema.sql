-- Reconcile the live social dispatch contract when historical migration metadata
-- says it was applied but the required objects are absent. Additive and fail-closed:
-- no platform is enabled by this migration and no provider is called.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook','instagram','x','linkedin','telegram','tiktok','youtube')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed','skipped')),
  external_post_id text,
  error_message text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claimed_at timestamptz,
  reconciliation_class text,
  reconciliation_reason text,
  reconciled_at timestamptz,
  reconciled_by text,
  dispatch_started_at timestamptz,
  UNIQUE (article_id, platform)
);

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_class text,
  ADD COLUMN IF NOT EXISTS reconciliation_reason text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by text,
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz;

CREATE INDEX IF NOT EXISTS social_posts_dispatch_claim_idx
  ON public.social_posts(status, created_at, updated_at)
  WHERE status IN ('pending','failed');

CREATE TABLE IF NOT EXISTS public.social_platforms (
  platform text PRIMARY KEY CHECK (platform IN ('facebook','instagram','x','linkedin','telegram','tiktok','youtube')),
  display_name text NOT NULL,
  required_secrets text[] NOT NULL DEFAULT '{}',
  names_verified boolean NOT NULL DEFAULT false,
  daily_post_limit integer CHECK (daily_post_limit > 0),
  min_gap_minutes integer NOT NULL DEFAULT 30 CHECK (min_gap_minutes >= 0),
  enabled boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.social_platforms(platform, display_name, required_secrets, names_verified, enabled, is_enabled, daily_post_limit, min_gap_minutes)
VALUES
  ('facebook','Facebook Page',ARRAY['SOCIAL_FACEBOOK_PAGE_ID','SOCIAL_FACEBOOK_PAGE_TOKEN'],false,false,false,30,30),
  ('instagram','Instagram Business',ARRAY['SOCIAL_INSTAGRAM_BUSINESS_ACCOUNT_ID','SOCIAL_INSTAGRAM_ACCESS_TOKEN'],false,false,false,8,60),
  ('x','X',ARRAY['SOCIAL_X_ACCESS_TOKEN'],false,false,false,30,30),
  ('linkedin','LinkedIn Organization',ARRAY['SOCIAL_LINKEDIN_ACCESS_TOKEN','SOCIAL_LINKEDIN_ORGANIZATION_ID'],false,false,false,10,60),
  ('telegram','Telegram Channel',ARRAY['SOCIAL_TELEGRAM_BOT_TOKEN','SOCIAL_TELEGRAM_CHANNEL_ID'],false,false,false,50,10),
  ('tiktok','TikTok',ARRAY['SOCIAL_TIKTOK_ACCESS_TOKEN'],false,false,false,NULL,0)
ON CONFLICT (platform) DO NOTHING;

CREATE OR REPLACE VIEW public.social_dispatch_readiness_v2
WITH (security_invoker = true) AS
SELECT
  p.platform,
  p.daily_post_limit,
  p.min_gap_minutes,
  (p.enabled AND p.is_enabled AND p.names_verified AND cardinality(p.required_secrets) > 0
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p.required_secrets) AS secret_name
      WHERE NOT EXISTS (
        SELECT 1 FROM public.api_vault v
        WHERE v.service_name = secret_name
          AND v.environment = 'prod'
          AND v.is_active
          AND v.key_encrypted IS NOT NULL
      )
    )) AS is_ready
FROM public.social_platforms p;

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_platforms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_posts, public.social_platforms, public.social_dispatch_readiness_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.social_posts, public.social_platforms TO service_role;
GRANT SELECT ON public.social_dispatch_readiness_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.claim_social_posts(
  p_platforms text[], p_limit integer, p_lease_seconds integer
)
RETURNS TABLE(id uuid, article_id uuid, platform text, attempt_count integer, claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 40
     OR p_lease_seconds IS NULL OR p_lease_seconds < 120 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid_social_claim_bounds';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT q.id
    FROM public.social_posts q
    WHERE q.platform = ANY(p_platforms)
      AND q.dispatch_started_at IS NULL
      AND (q.status = 'pending' OR (q.status = 'failed' AND q.attempt_count < 5))
      AND (q.claim_token IS NULL OR q.claimed_at < clock_timestamp() - make_interval(secs => p_lease_seconds))
    ORDER BY q.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.social_posts q
    SET claim_token = gen_random_uuid(), claimed_at = clock_timestamp(), updated_at = clock_timestamp()
    FROM candidates c
    WHERE q.id = c.id
    RETURNING q.id, q.article_id, q.platform, q.attempt_count, q.claim_token
  )
  SELECT c.id, c.article_id, c.platform, c.attempt_count, c.claim_token FROM claimed c;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_social_posts(text[], integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_social_posts(text[], integer, integer) TO service_role;

COMMENT ON COLUMN public.social_posts.dispatch_started_at IS
  'Durable side-effect barrier: rows after provider invocation require receipt reconciliation and are never auto-republished.';

COMMIT;
