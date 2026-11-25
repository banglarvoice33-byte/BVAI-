-- Recovered from production: feed_enabled was added to source_registry
-- out-of-band (not present in 20260920_source_registry.sql). The view
-- public.public_source_registry in 20261010010000_sync_unversioned_objects.sql
-- references this column, so a clean replay failed at CREATE VIEW until now.
--
-- Idempotent: on existing databases where the column was added manually,
-- this is a no-op.
ALTER TABLE public.source_registry
  ADD COLUMN IF NOT EXISTS feed_enabled boolean NOT NULL DEFAULT true;
