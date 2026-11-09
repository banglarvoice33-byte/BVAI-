-- Remove implicit public-schema lookup from privileged and trigger functions.
BEGIN;

ALTER FUNCTION public.current_app_role() SET search_path = '';
ALTER FUNCTION public.set_breaking_ticker(text) SET search_path = '';
ALTER FUNCTION public.set_user_role(uuid, public.app_role) SET search_path = '';
ALTER FUNCTION public.submit_field_report(uuid) SET search_path = '';
ALTER FUNCTION public.touch_source_registry() SET search_path = '';

COMMIT;
