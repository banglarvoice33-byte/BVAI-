-- Additive only: allow tiktok in video_delivery_outbox platform check.
-- Does not enable delivery, does not touch existing rows, does not activate cron.
BEGIN;

ALTER TABLE public.video_delivery_outbox
  DROP CONSTRAINT IF EXISTS video_delivery_outbox_platform_check;

ALTER TABLE public.video_delivery_outbox
  ADD CONSTRAINT video_delivery_outbox_platform_check
  CHECK (platform IN ('youtube','facebook','instagram','tiktok'));

COMMIT;
