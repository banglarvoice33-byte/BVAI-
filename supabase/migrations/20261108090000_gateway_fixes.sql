-- Gateway fixes applied in Dashboard: allow gemini and meta + audit columns.
-- Idempotent for columns; constraint is replaced with the verified provider set.
BEGIN;

ALTER TABLE public.ai_gateway_key_state
  DROP CONSTRAINT IF EXISTS ai_gateway_key_state_provider_check;

ALTER TABLE public.ai_gateway_key_state
  ADD CONSTRAINT ai_gateway_key_state_provider_check
  CHECK (provider IN ('openrouter', 'groq', 'ollama', 'gemini', 'meta'));

ALTER TABLE public.ai_gateway_usage_events
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.ai_gateway_usage_events
  ADD COLUMN IF NOT EXISTS final_error_code text;

COMMIT;
