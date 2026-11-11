-- Forward-only missing-schema reconciliation. Never enables publishing.
-- social_platforms is the actual application registry (not social_platform_registry).
BEGIN;
CREATE TABLE IF NOT EXISTS public.social_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
 platform text NOT NULL CHECK(platform IN ('facebook','instagram','x','linkedin','telegram','tiktok','youtube')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','failed','skipped')),
 external_post_id text,error_message text,attempt_count integer NOT NULL DEFAULT 1 CHECK(attempt_count>0),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,posted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(article_id,platform)
);
ALTER TABLE public.social_posts
 ADD COLUMN IF NOT EXISTS claim_token uuid,
 ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
 ADD COLUMN IF NOT EXISTS reconciliation_class text,
 ADD COLUMN IF NOT EXISTS reconciliation_reason text,
 ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
 ADD COLUMN IF NOT EXISTS reconciled_by text,
 ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz;
CREATE INDEX IF NOT EXISTS social_posts_dispatch_claim_idx ON public.social_posts(status,created_at,updated_at) WHERE status IN ('pending','failed');
CREATE TABLE IF NOT EXISTS public.social_platforms (
 platform text PRIMARY KEY,
 display_name text NOT NULL,
 required_secrets text[] NOT NULL DEFAULT '{}',
 names_verified boolean NOT NULL DEFAULT false,
 daily_post_limit integer CHECK(daily_post_limit>0),
 min_gap_minutes integer NOT NULL DEFAULT 30 CHECK(min_gap_minutes>=0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
-- Historical installs used two enable-column spellings; retain both and fail closed.
ALTER TABLE public.social_platforms
 ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT false;
INSERT INTO public.social_platforms(platform,display_name,required_secrets) VALUES
 ('facebook','Facebook Page',ARRAY['SOCIAL_FACEBOOK_PAGE_ID','SOCIAL_FACEBOOK_PAGE_TOKEN']),
 ('instagram','Instagram Business',ARRAY['SOCIAL_INSTAGRAM_BUSINESS_ACCOUNT_ID','SOCIAL_INSTAGRAM_ACCESS_TOKEN']),
 ('x','X',ARRAY['SOCIAL_X_ACCESS_TOKEN']),
 ('linkedin','LinkedIn',ARRAY['SOCIAL_LINKEDIN_ACCESS_TOKEN','SOCIAL_LINKEDIN_ORGANIZATION_ID']),
 ('telegram','Telegram',ARRAY['SOCIAL_TELEGRAM_BOT_TOKEN','SOCIAL_TELEGRAM_CHANNEL_ID']),
 ('tiktok','TikTok',ARRAY['SOCIAL_TIKTOK_ACCESS_TOKEN'])
ON CONFLICT(platform) DO NOTHING;
-- New versioned view avoids CREATE OR REPLACE column-order/type drift of the old view.
CREATE OR REPLACE VIEW public.social_dispatch_readiness_v2 WITH(security_invoker=true) AS
SELECT p.platform,p.daily_post_limit,p.min_gap_minutes,
 (p.enabled AND p.is_enabled AND p.names_verified AND cardinality(p.required_secrets)>0
  AND NOT EXISTS(SELECT 1 FROM unnest(p.required_secrets) secret_name
   WHERE NOT EXISTS(SELECT 1 FROM public.api_vault v WHERE v.service_name=secret_name
     AND v.environment='prod' AND v.is_active AND v.key_encrypted IS NOT NULL))) AS is_ready
FROM public.social_platforms p;
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_platforms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_posts,public.social_platforms,public.social_dispatch_readiness_v2 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.social_posts,public.social_platforms TO service_role;
GRANT SELECT ON public.social_dispatch_readiness_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.claim_social_posts(p_platforms text[],p_limit integer,p_lease_seconds integer)
RETURNS TABLE(id uuid,article_id uuid,platform text,attempt_count integer,claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>40 OR p_lease_seconds IS NULL OR p_lease_seconds<120 OR p_lease_seconds>3600 THEN RAISE EXCEPTION 'invalid_social_claim_bounds'; END IF;
 -- A provider operation may have succeeded before the process died. NEVER
 -- automatically reclaim rows that have crossed the durable side-effect barrier.
 RETURN QUERY WITH candidates AS (
   SELECT q.id FROM public.social_posts q
   WHERE q.platform=ANY(p_platforms) AND q.dispatch_started_at IS NULL
    AND (q.status='pending' OR (q.status='failed' AND q.attempt_count<5))
    AND (q.claim_token IS NULL OR q.claimed_at<clock_timestamp()-make_interval(secs=>p_lease_seconds))
   ORDER BY q.created_at FOR UPDATE SKIP LOCKED LIMIT p_limit
 ), claimed AS (
   UPDATE public.social_posts q SET claim_token=gen_random_uuid(),claimed_at=clock_timestamp()
   FROM candidates c WHERE q.id=c.id RETURNING q.id,q.article_id,q.platform,q.attempt_count,q.claim_token
 ) SELECT c.id,c.article_id,c.platform,c.attempt_count,c.claim_token FROM claimed c;
END $$;
REVOKE ALL ON FUNCTION public.claim_social_posts(text[],integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_social_posts(text[],integer,integer) TO service_role;
COMMENT ON COLUMN public.social_posts.dispatch_started_at IS 'Durable side-effect barrier: non-null rows need provider receipt reconciliation before retry. Never clear automatically.';
COMMIT;
