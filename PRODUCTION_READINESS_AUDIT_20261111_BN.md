# বাংলার ভয়েস — Production Readiness Audit

**Audit time:** ১১ নভেম্বর ২০২৬, প্রায় ০৮:৩০ বাংলাদেশ সময় (02:30 UTC)  
**Supabase project:** `BVAI` (`rtejxeamxeycnpcwnseo`, `ap-southeast-1`)  
**Input package:** `BVAI-CLEAN-ONLY.zip` (archive timestamps ১০ নভেম্বর ২০২৬)  
**Scope:** Supabase live state, current newsroom cadence, recent ingest receipts, media queue, social dispatch, GitHub repository visibility, packaged source.

## Executive finding

The newsroom ingest trigger is alive, but the required end-to-end publication and video/social distribution service is **not production-ready**. Recent cron executions return HTTP 200 and five configured sources respond HTTP 200; however, recent runs fetched 30 feed entries and skipped 29, with no publishable item in the latest run. In the last 24 hours the database had 16 new article rows: 4 published and 12 pending. There were 0 video rows, 0 video-generation jobs and 0 video-delivery outbox rows. Social dispatch returned `social_dispatched: 0` in observed responses.

Do not interpret a green cron receipt or HTTP 200 as a published article, rendered video, or successful social post.

## Verified live facts

| Area | Live evidence | Assessment |
|---|---|---|
| Supabase | Project `BVAI` is `ACTIVE_HEALTHY`; Postgres 17.11; region `ap-southeast-1` | Database reachable |
| Applied migrations | Latest recorded migration is `20261110233227 trusted_source_video_gate` | Current project includes recent source-video gate |
| Cron heartbeat | `bvai-newsroom-14m` active, cron expression `* * * * *`; function has advisory lock and a 14-minute throttle | One-minute heartbeat, 14-minute effective daytime/overnight cadence at audit time |
| Latest request | `2026-11-11 02:27 UTC`; HTTP 200; 5 sources processed; 30 fetched; 29 skipped; 1 queued; 0 published; 0 failures | Ingest executes, output is low |
| Recent source health | Five source IDs reported HTTP 200 in latest run | Transport healthy; this does not establish editorial accuracy |
| Articles, last 24h | 16 created; 4 published; 12 pending | Target publication rate is not met |
| Pending reasons | Observed `image_not_related`, `number_not_in_source`, `identical_run`, `ai_rewrite_deadline` | Quality gates are stopping items; improve media matching and fact fidelity rather than bypassing them |
| Video pipeline | 0 rows in `videos`; 0 `video_generation_jobs`; 0 `video_generation_assets`; 0 `video_delivery_assets` | No current generated video evidence |
| Video distribution | `video_delivery_outbox` exists but has 0 rows | No queued platform video deliveries |
| Social DB contract | Live database does not currently contain `social_posts` or `social_platform_registry` tables, although the deployed `social-dispatch` source queries `social_posts` and `claim_social_posts` | Deployed social dispatcher cannot complete its normal queue path against this live schema |
| Social function | `SOCIAL_AUTOMATION_ENABLED` must equal `true`; otherwise function returns `{disabled:true,processed:0}` | Social publishing is explicitly disabled by default |
| Social URL defect | Packaged/deployed dispatcher hard-codes `https://example.invalid` for article and social-card URLs | Critical link-generation bug; corrected in this package only, not deployed |
| YouTube function | `youtube-sync` reads the configured channel's own Atom feed and syncs inventory; it does not upload new generated videos | Inbound inventory sync is not outbound publishing |
| GitHub | Connected GitHub lookup for `MATI-AI-HUB/automation-king-` returned 404; org search returned no matching repository | Cannot safely push until exact accessible repository URL/permissions are restored |

## Editorial policy interpretation

The live migration `20261110233227_trusted_source_video_gate` implements a video-gate distinction:

- Curated aggregated news from an enabled, non-kill-switched source can qualify for the trusted-source video path when source identity, URL, publication time and verification status are present.
- Field reports and non-aggregated/original/manual content remain human/editorial-gated.
- Freshness, evidence hash, rights and other safety checks remain in force.

This does **not** mean every story from a famous outlet is automatically reliable or may be published without verification. Source branding alone is not proof that the article's facts, media, location and timestamp match. Routine syndicated stories may skip manual editorial approval only after the configured independent corroboration and automated claim/media checks pass. High-risk claims should require stronger independent corroboration/authority checks; reporter-app submissions must remain pending until Admin/Studio approval.

The package still contains older documentation/migration text describing human review for all risk classes. That documentation is stale relative to the later trusted-source video-gate migration and should not be used as the live policy statement without reconciliation.

## Validation performed for this ZIP

- Confirmed the social-dispatch source no longer contains the hard-coded `BASE_URL = https://example.invalid`; static checks confirmed canonical HTTPS lookup, protected DB fallback and fail-closed behavior.
- `unzip -t` passed for the updated archive.
- Deno/Supabase CLI deployment, hosted migration replay, TypeScript compilation and end-to-end provider posts were not run in this sandbox.

## Changes included in this updated ZIP

1. **Social URL fail-closed correction** in `supabase/functions/social-dispatch/index.ts`:
   - Removed hard-coded `example.invalid` site root.
   - Resolves canonical HTTPS `SITE_URL` / `NEXT_PUBLIC_SITE_URL`, then protected `deployment_settings.SITE_URL`.
   - Rejects missing/invalid URL and returns 503 before publishing rather than generating broken public links.
   - This is a source-package change only; it has not been deployed to Supabase.
2. **Bangladesh-local cadence migration** in `supabase/migrations/20261111030000_dhaka_business_hours_cadence.sql`:
   - 06:00–23:59 Asia/Dhaka: 14-minute trigger interval.
   - 00:00–05:59 Asia/Dhaka: 60-minute trigger interval.
   - Preserves advisory locking, Vault-backed ingest secret, HTTPS origin validation and request-receipt semantics.
   - Not applied to the live database; apply only after review and migration replay.
3. This audit document records the current production blockers and safe rollout sequence.

## Critical blockers before enabling distribution

1. Reconcile the missing live social queue schema (`social_posts`, claim RPC and platform registry) with the currently deployed `social-dispatch` code. Do not turn on `SOCIAL_AUTOMATION_ENABLED` until the schema, RLS, queue claim/lease and idempotency contracts are installed and tested.
2. Confirm the video generator is deployed and can claim a published article, create a unique story reservation, render a 40–120 second vertical MP4, upload it to private Supabase Storage, and create a delivery outbox row. Current live evidence shows none of these outputs.
3. Connect video delivery to official provider APIs. Facebook/Instagram/YouTube credentials, scopes, account IDs, app review and upload receipts are required. A function being `ACTIVE` is not proof of provider access.
4. YouTube's current function is an inventory synchronizer, not an upload publisher. Implement/verify the official YouTube Data API upload worker separately.
5. Verify the public site base URL and public social-card endpoint before enabling posts.
6. Increase the active source set only with maintained, authentic feeds and per-source freshness/duplicate monitoring. Latest live evidence shows five healthy feeds but 30 fetched items with 29 skipped; simply adding RSS URLs will not fix the publish bottleneck.
7. Diagnose pending `image_not_related` and `number_not_in_source` cases. Use licensed, topic-matched media or clearly labeled symbolic visuals; do not reuse an unrelated image as if it depicts the event.
8. Preserve unique-video enforcement with SHA-256 + source asset ID + article/story reservation. Do not delete the only audit evidence; delete temporary downloaded files after upload/render verification while retaining hash, licence, attribution and deletion receipt.

## Quality and output targets

- Article cadence is a trigger target, not a guarantee that a story will pass quality checks. Do not lower source verification or copyright gates to meet volume.
- Target 40–120 seconds per short/reel, with readable Bengali captions, source attribution, event/time/location fidelity, clear visual context, and the closing CTA: **“বিস্তারিত দেখতে বাংলার ভয়েস ওয়েবসাইট ভিজিট করুন।”**
- Do not fabricate B-roll or imply symbolic footage is real event footage. Label representative footage visibly and in the description.
- One video asset must map to one story reservation and one SHA-256; retries must reuse the same render, not create duplicate uploads.
- Ten social destinations cannot be guaranteed by a single API call. Each destination requires an enabled platform contract, valid official credentials/scopes, per-platform rate limits and a provider receipt.

## Supabase advisor observations

The live security advisor reported seven RLS-enabled tables without policies (including AI gateway budget/usage/config tables and deployment settings), an extension in `public`, and public/authenticated execution warnings for selected `SECURITY DEFINER` functions. The performance advisor reported one duplicate index on `articles`. These require object-by-object privilege review; do not add permissive policies or revoke functions blindly because some tables are intentionally service-only.

## Termux: safe verification and Git handoff

The ZIP is a source archive and does **not** contain `.git`. Extract it, then copy the changed files into the real Git clone after confirming the canonical repository URL. Example (adjust the downloaded ZIP path and clone folder):

```bash
pkg install git unzip nodejs-lts -y
mkdir -p "$HOME/bvai-audit"
unzip -o /sdcard/Download/BVAI-CLEAN-ONLY-UPDATED-20261111.zip -d "$HOME/bvai-audit"

# Existing clone: do not guess a repository URL or overwrite an unrelated remote.
cd "$HOME/automation-king-"   # change to your actual clone directory

git remote -v
git branch --show-current
git status --short

# Copy only the reviewed changed files from the extracted archive.
cp "$HOME/bvai-audit/supabase/functions/social-dispatch/index.ts" supabase/functions/social-dispatch/index.ts
cp "$HOME/bvai-audit/supabase/migrations/20261111030000_dhaka_business_hours_cadence.sql" supabase/migrations/
cp "$HOME/bvai-audit/PRODUCTION_READINESS_AUDIT_20261111_BN.md" .

# Check local toolchain and migration text.
node --version
npm --version
supabase --version || true
sed -n '1,220p' supabase/migrations/20261111030000_dhaka_business_hours_cadence.sql

# Run project checks from the repository root (if the corresponding scripts exist).
npm ci --no-audit --no-fund
npm run check:publish-gate
git diff --check
git diff -- supabase/functions/social-dispatch/index.ts supabase/migrations/20261111030000_dhaka_business_hours_cadence.sql

# Commit/push only after verifying the remote and CI policy.
git add supabase/functions/social-dispatch/index.ts \
  supabase/migrations/20261111030000_dhaka_business_hours_cadence.sql \
  PRODUCTION_READINESS_AUDIT_20261111_BN.md
git commit -m "fix: harden social URL and Dhaka newsroom cadence"
git push origin HEAD
```

The root archive package does not define an `npm test` script; run the worker/frontend package-specific scripts from their directories after installing their lockfiles. Do not run a guessed test command.

**Important:** the connected GitHub integration returned 404 for the repository name supplied in the earlier context. The commands above intentionally do not invent or overwrite a remote. First confirm `git remote -v` points to the correct repository and that the account has push permission. If it is wrong, set the correct remote only after the owner provides/validates the canonical URL.

## Safe rollout order

1. Confirm GitHub repository and merge the source changes through CI.
2. Replay all migrations in a disposable Supabase project; verify the 00:00/06:00 Dhaka boundary and 14/60-minute interval behavior.
3. Apply the cadence migration to production only after review; verify `cron.job` and `cron.job_run_details`.
4. Reconcile live social tables/RPCs and platform readiness; test one Facebook Page post in a controlled account and verify the returned provider ID.
5. Deploy and verify the unique-video generation worker and Supabase Storage lifecycle.
6. Enable one platform at a time, then YouTube upload, then additional official platforms. Require a provider receipt for each.
7. Run 24–72 hours of shadow/low-volume monitoring before claiming the article/video SLA is met.

**Current release verdict: BLOCKED for full automatic video + multi-platform distribution.** News ingestion is running; article publication rate is below target; social/video posting is not evidenced by live rows or provider receipts.
