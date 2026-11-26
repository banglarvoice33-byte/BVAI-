# Video publish path — root cause and required dashboard steps

## Why automation was not publishing to YouTube

Verified against `main` on 2026-11-26:

1. **`VIDEO_PUBLISH_MODE=review`** was hardcoded in:
   - `render.yaml` → service `bvai-video-renderer`
   - `deploy/video-renderer.Dockerfile` `ENV`
2. `run-bvai.sh` only runs `delivery-worker.mjs` when:
   ```bash
   VIDEO_PUBLISH_MODE == distribute && VIDEO_DELIVERY_ENABLED != false
   ```
3. **`VIDEO_DELIVERY_PLATFORMS` was empty** on the renderer service.  
   `delivery-worker.mjs` exits immediately if platforms is empty.
4. YouTube OAuth env vars (`OAUTH_*`, `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_CHANNEL_ID`) were listed under **`bvai-worker`** (Agnes loop), not under **`bvai-video-renderer`** (the process that actually enqueues/uploads).
5. GitHub Actions workflow **BVAI Durable Video Delivery** also requires repo **Variables**:
   - `VIDEO_DELIVERY_PLATFORMS=youtube`
   - `VIDEO_DELIVERY_ENABLED=true` (or unset)
   and Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_REFRESH_TOKEN`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `YOUTUBE_CHANNEL_ID`.

Code fix in this commit sets mode=`distribute` and wires the correct env keys onto `bvai-video-renderer`.

## Dashboard steps you must still do (cannot be done from git alone)

### Render.com → `bvai-video-renderer`

Set environment values (Dashboard → Environment):

| Key | Value |
|-----|--------|
| `VIDEO_PUBLISH_MODE` | `distribute` |
| `VIDEO_DELIVERY_ENABLED` | `true` |
| `VIDEO_DELIVERY_PLATFORMS` | `youtube` |
| `YOUTUBE_CHANNEL_ID` | your UC… channel id |
| `YOUTUBE_REFRESH_TOKEN` | from Google OAuth |
| `OAUTH_CLIENT_ID` | Google client id |
| `OAUTH_CLIENT_SECRET` | Google client secret |
| `SUPABASE_URL` | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |

Redeploy the service after saving.

### GitHub → Settings → Secrets and variables → Actions

**Variables:**

- `VIDEO_DELIVERY_PLATFORMS` = `youtube`
- `VIDEO_DELIVERY_ENABLED` = `true`
- `VIDEO_PUBLISH_MODE` = `distribute`
- `YOUTUBE_CHANNEL_ID` = `UCxxxxxxxx`

**Secrets:**

- `YOUTUBE_REFRESH_TOKEN`
- `OAUTH_CLIENT_ID`
- `OAUTH_CLIENT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Then run workflow **BVAI Durable Video Delivery** → `workflow_dispatch` once to drain any queued outbox rows.

### Supabase Vault

You already store YouTube secrets in vault. `delivery-worker.mjs` reads `api_vault` via `decrypt_vault_secret` when process env is missing. Ensure rows exist for:

- `YOUTUBE_REFRESH_TOKEN` (or aliases used in code)
- `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`
- environment = `prod`, `is_active` = true

### Verify

```bash
# On renderer host or locally with the same env:
node scripts/pipeline/check-delivery-config.mjs
# Expect: OK: delivery config looks sufficient for YouTube enqueue + upload
```

SQL (Supabase SQL editor):

```sql
select id, platform, status, updated_at
from video_delivery_outbox
order by updated_at desc
limit 20;
```

Statuses of interest: `queued`, `retrying`, `processing`, `delivered`, `dead_letter`.

## Free Render 512 MB plan

Do **not** move the ffmpeg/Agnes render worker to the free 512 MB instance.  
Node + ffmpeg + temp clips routinely exceed 512 MB and will OOM-kill mid-render.  
Keep `bvai-worker` on **standard** and `bvai-video-renderer` on **starter** (or higher). Cap storage to ~12 videos in Supabase is fine; that is independent of RAM.

## Frontend / Vercel (separate outage)

`https://www.banglarvoice24news.com` and apex return **Vercel `DEPLOYMENT_NOT_FOUND`**.  
That is not a code bug in `render.yaml` — the production deployment is missing or unbound.

Fix in Vercel dashboard:

1. Import or reconnect repo `banglarvoice33-byte/BVAI-`
2. Root Directory: `frontend`
3. Framework: Next.js
4. Env: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, …
5. Redeploy Production and attach custom domain DNS

Responsive layout is already present (`viewport` in `app/layout.tsx`, Tailwind breakpoints, mobile-first CSS). It cannot be confirmed live while the deployment is 404.
