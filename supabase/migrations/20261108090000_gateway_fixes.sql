-- Gateway fixes applied in Dashboard: allow gemini/【entity-meta¦canonical_name=meta】 + audit columns
alter table public.ai_gateway_key_state
drop constraint if exists ai_gateway_key_state_provider_check;

alter table public.ai_gateway_key_state
add constraint ai_gateway_key_state_provider_check
check (provider in ('openrouter','groq','ollama','gemini','【entity-meta¦canonical_name=meta】'));

alter table public.ai_gateway_usage_events
add column if not exists retry_count int not null default 0;

alter table public.ai_gateway_usage_events
add column if not exists final_error_code text;
