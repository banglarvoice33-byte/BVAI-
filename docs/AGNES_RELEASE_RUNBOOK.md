# Agnes visual pipeline release runbook

## Current implementation boundary

Agnes is an opt-in visual provider inside the existing BVAI render claim and approval flow. The default remains `VIDEO_VISUAL_PROVIDER=licensed`; changing it to `agnes` generates one short clip per measured visual slot, sequentially. The renderer does not publish directly. The existing uploader, quality checks, human approval policy, and delivery reconciliation remain authoritative.

## Provider capability matrix

- Model: `agnes-video-2.5-flash` by default.
- Resolution: `720P` for Flash. The adapter rejects `1080P` when the Flash model is selected.
- Aspect ratio: `9:16` by default.
- Clip duration: measured scene duration is rounded and clamped to 4–12 seconds. FFmpeg loops or trims each downloaded clip to the exact measured slot duration.
- Concurrency: no parallel Agnes calls. Generation and polling are sequential per claimed job.
- Polling: the adapter sends `video_id` and `model_name` on every poll and retries network errors, HTTP 429, and HTTP 5xx with bounded exponential backoff.
- Download: provider output is streamed to a new local file using `wx`; the file receives a streamed SHA-256 hash before it enters the manifest.
- Disclosure: the rendered overlay says `এআই ভিজ্যুয়াল`; credits say `এআই-উৎপাদিত ভিজ্যুয়াল · মানব যাচাই আবশ্যক`.
- Metadata: synthetic assets are labelled as AI-generated output. Temporary provider download URLs are not persisted in the production manifest; provider documentation URLs and the external task ID are retained.

## Required environment placement

Keep `AGNES_API_KEY`, ElevenLabs keys, Supabase service-role credentials, and delivery credentials in server-side GitHub Secrets, Render secrets, or the worker secret store. Do not add them to Vercel client/runtime variables, `NEXT_PUBLIC_*`, committed files, logs, manifests, or public URLs.

The renderer now accepts `AGNES_API_KEY_1` through `AGNES_API_KEY_5` (and the legacy `AGNES_API_KEY`) and tries them sequentially per slot only after authentication, rate-limit, timeout, or server failures. It never runs Agnes calls concurrently, never logs key values, and does not switch keys for prompt/configuration errors. The TTS router already supports ordered Sarvam, SonexLabs, Cartesia, and ElevenLabs key candidates through its indexed server-side variables.

For a pilot, configure the server-side worker with:

```text
VIDEO_VISUAL_PROVIDER=agnes
AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
AGNES_MODEL=agnes-video-2.5-flash
AGNES_SIZE=720P
AGNES_ASPECT_RATIO=9:16
AGNES_POLL_INTERVAL_MS=1500
AGNES_TIMEOUT_MS=600000
```

Keep delivery disabled until the pilot passes the approval and reconciliation gates. The repository example retains `VIDEO_DELIVERY_ENABLED=false`.

## Release gates

1. Local gate: `npm test` passes. The current baseline is 179 tests, 178 pass, and 1 SQL-dependent test is skipped when the disposable database is unavailable.
2. Static gate: `npm run check:imports`, `node --check` for modified modules, and `git diff --check` pass.
3. Provider gate: use a real Agnes key in a non-production pilot and verify create, poll, download, timeout, 429/5xx retry, and provider failure behavior. Never use a production article for the first run.
4. Timing gate: compare VTT/audio boundaries, generated clip count, segment durations, and final duration. Confirm that no Agnes request is concurrent and that every slot has a corresponding asset or an explicit brand fallback.
5. Quality gate: inspect the final 1080x1920 MP4 for decode, captions, loudness, disclosure label, no provider watermark/text, and no misleading event footage. Existing `technicalReport` and `inspectWithRepair` must pass.
6. Editorial gate: reporter, field-report, manual, and original-media content still requires fresh asset-bound human approval. Synthetic visuals never establish factual verification.
7. Storage gate: verify the final upload uses the existing transactional Supabase finalize path. Confirm local downloaded Agnes files are removed after a confirmed render and remain available for failure diagnosis until the claim is failed.
8. Delivery gate: do not claim YouTube or other publication without the provider receipt, persisted reconciliation state, and a subsequent read-back confirming the platform status.

## Rollback

To disable Agnes without a code rollback, set `VIDEO_VISUAL_PROVIDER=licensed` in the server-side render environment and rerun the existing licensed path. Do not delete jobs or manually mark output as published. If a render is already staged, follow the existing `manifest.json` upload-only/reconciliation procedure before starting another claim. If a deployed commit is unhealthy, use the existing Vercel/Render rollback mechanism only after identifying the exact deployment and preserving the failed-render evidence.

## Verified external configuration and current blockers

- Vercel project inspection is complete read-only. The connected project is `bvai`, and its latest production deployment is READY for the previously pushed commit. The current local Agnes changes have not been committed or deployed.
- Supabase project `BVAI` (`rtejxeamxeycnpcwnseo`) is `ACTIVE_HEALTHY`. Read-only metadata inspection found one active Agnes mapping (`VIDEO_AGNES_API_KEY`) and one `AGNES_API_KEY` Vault secret name, not multiple Agnes keys. No Cloudflare key or verified Cloudflare video-generation replacement was found; Cloudflare must not be added as an assumed Agnes substitute.
- Supabase read-only metadata inspection found no TTS-specific `api_vault` or Vault names for Sarvam, SonexLabs, Cartesia, or ElevenLabs. Existing TTS fallback is therefore operational only where the corresponding server-side GitHub/Render variables are actually configured; it cannot be claimed from Vault metadata alone.
- GitHub CLI authentication is present, but Actions secrets/variables metadata requests returned HTTP 403 (`Resource not accessible by integration`). Secret presence cannot be truthfully confirmed through this token.
- Render inspection is not complete: the Render MCP returned `unauthorized` and no workspace ID. Do not guess a workspace, create a service, update secrets, trigger a deploy, or claim Render readiness until the connector is re-authorized and a workspace is confirmed.
- No real Agnes or ElevenLabs pilot was run because provider credentials and an approved staging article/pilot window were not available in this session.
- Vercel read-only inspection previously confirmed project `bvai` and a READY production deployment for the old commit; the current local changes are not yet deployed.
- No Supabase DDL migration was required for this integration. The existing `video_generation_jobs`, review, quality, and delivery contracts remain the control plane.

## Authoritative provider references

- Agnes Video 2.5 Flash: https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash
- ElevenLabs text-to-speech API: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- Existing BVAI distribution contract: `docs/VIDEO_DISTRIBUTION_CONTRACT.md`
