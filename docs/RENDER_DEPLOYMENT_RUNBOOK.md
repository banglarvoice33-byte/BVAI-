# BVAI Render Deployment Runbook

## Preconditions
- Supabase staging project cloned from production backup.
- Render account with billing enabled (worker needs >= 2 GB RAM for FFmpeg).
- Secrets ready: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_TOKEN,
  AGNES_API_KEY, TTS_ELEVENLABS_1, ELEVENLABS_VOICE_ID,
  TTS_CARTESIA_KEY (opt), CARTESIA_VOICE_ID (opt), TTS_SARVAM_KEY (opt),
  OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN, YOUTUBE_CHANNEL_ID.

## Steps
1. Back up Supabase production (Dashboard -> Database -> Backups -> Download).
2. Create staging clone.
3. Apply migrations in staging:
   `supabase db push --project-ref <staging-ref>`
   Or run `supabase/migrations/20261126000000_agnes_video_pipeline.sql` in SQL editor.
4. Deploy Render API: `render.yaml` blueprint -> New Blueprint Instance.
5. Deploy Agnes worker (same blueprint, worker service).
6. Set all env vars as Render secrets (never commit them).
7. Run healthcheck: `curl https://<api>.onrender.com/health`
8. Queue pilot: `curl -X POST .../dispatch -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"article_id":"<id>","payload":{"script":"<8 sentences>"}}'`
9. Inspect final.mp4 in Admin Console; verify manifest.qc.* all true.
10. Approve explicitly: insert into render_approvals with matching hashes.
11. Enqueue one YouTube delivery in delivery_outbox (status=pending).
12. Delivery worker picks it up; verify delivery_receipts + delivery_reconciliation rows.
13. Increase quota: 2 -> 4 -> 8 -> 12 videos/day via env var or code edit + migration.

## Health signals
- /health returns {"ok":true}
- agnes_job_events shows started/clip_ready/tts_ready/finished per job
- No `daily_quota_exceeded` unless expected
- No `lease_lost` in worker logs (indicates slow render)
