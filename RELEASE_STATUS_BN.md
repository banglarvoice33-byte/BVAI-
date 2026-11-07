# Banglar Voice 24 — Packaged Release Status

## Included in this package

এই package-এ Next.js frontend source, worker source, Supabase migrations ও Edge Functions, 12-minute scheduler, conservative fail-closed quality gate, পাঁচটি Flutter app source, CI workflows, local Bengali sample reel এবং deployment documentation রয়েছে।

Vercel-backed social ও YouTube cron migration-ও অন্তর্ভুক্ত হয়েছে। `social-dispatch`, `social-manager` এবং `youtube-sync` Edge Functions Supabase project-এর ভেতরে চলবে।

## Previously verified

- Frontend typecheck: passed
- Worker typecheck: passed
- Worker tests: 12 files / 59 tests passed
- Frontend এবং worker publish-gate byte-identical
- Scheduler source interval: 12 minutes
- Auto-publish implicit default: false
- Routine quality gate: minimum 2 independent sources and 2 successful verifiers
- Sensitive/critical quality gate: minimum 3 independent sources, 3 successful verifiers and authority approval
- Local sample reel: 1080x1920, 11.76 seconds, MP4, not published

## Vercel cron migration

The six Vercel-backed jobs are now represented by Supabase-native Edge Function targets. The package includes `social-dispatch`, `social-manager` and `youtube-sync` functions, `supabase/config.toml` entries, migration `20261107030000_move_social_youtube_jobs_to_edge_functions.sql`, and manual opt-in SQL `deploy/enable-edge-automation-schedules.sql`.

The migration unschedules the old jobs, creates six Supabase Function cron targets, and leaves them inactive. It does not enable production automation automatically. The new handlers reject Vercel-specific headers and require the configured service credential.

## APK status

APK/AAB was not generated in this sandbox because Flutter/Dart and an Android signing keystore were unavailable. The five app sources and Android release workflows are included. To produce signed release artifacts, run the included GitHub Actions workflow with `SITE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ANDROID_KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD`.

Never put the service-role key in any mobile build.

## Deployment status

This package has not been pushed to GitHub, merged into `main`, deployed to Vercel/Cloudflare, or applied to a live Supabase project. Scheduler jobs remain opt-in and must be enabled only after Edge Function deployment, secret configuration, disposable migration replay and first-run verification in `cron.job_run_details`.

Deno and Supabase CLI were not installed in this sandbox, so Edge Function deployment and hosted migration replay remain deployment-time checks. The source was statically checked for Vercel references, forbidden Next.js imports and missing Edge Function target paths.
