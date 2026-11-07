-- Restored verbatim from applied production migration history.
-- Already applied in production; retained to restore clean replay on fresh databases.
revoke all on function public.video_generation_guard_transition() from public;
revoke all on function public.video_generation_guard_transition() from anon, authenticated;
grant execute on function public.video_generation_guard_transition() to service_role;

revoke all on function public.video_generation_record_event() from public;
revoke all on function public.video_generation_record_event() from anon, authenticated;
grant execute on function public.video_generation_record_event() to service_role;

revoke all on function public.video_generation_set_updated_at() from public;
revoke all on function public.video_generation_set_updated_at() from anon, authenticated;
grant execute on function public.video_generation_set_updated_at() to service_role;
