# Rollback Plan

## Immediate rollback
1. Pause Render worker (Dashboard -> bvai-worker -> Suspend).
2. Apply down migration:
   `psql $DATABASE_URL -f supabase/migrations/20261126000000_agnes_video_pipeline.down.sql`
   This drops all pipeline tables. Use only in staging first.
3. Redeploy previous image from Render "Deploys" tab -> "Rollback".

## Data preservation
- Export `agnes_video_jobs` and `delivery_receipts` to JSON before down migration:
  `supabase db dump --data-only -t agnes_video_jobs -t delivery_receipts > backup.json`
- Store backup in Supabase Storage (private bucket).

## Post-rollback verification
- `/health` still responds if API kept running.
- GitHub Actions `render-healthcheck` does not fire alerts.
- No pending jobs in `agnes_video_jobs` with status in ('queued','claimed','running').
