# Render deploy fix: `open Dockerfile: no such file or directory`

## Error you saw

```
transferring dockerfile: 2B done
error: failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory
```

Cause: the Render **service** has empty/wrong **Dockerfile Path**, so it looks for `/Dockerfile` at the **Root Directory**. Until commit with root `Dockerfile`, that file did not exist.

## Fix (pick one)

### A) Re-deploy after root Dockerfile (now on main)

1. Ensure latest `main` is pulled (commit message includes root Dockerfile).
2. Render → Manual Deploy → Deploy latest commit.

### B) Set paths in service Settings (recommended)

For **video only on Render** (Background Worker):

| Setting | Value |
|---------|--------|
| Language / Runtime | Docker |
| Root Directory | *(empty)* |
| Dockerfile Path | `deploy/video-renderer.Dockerfile` |
| Docker Command | *(empty — use image CMD)* |
| Instance type | **Background Worker** (not Web Service) |
| Plan | Starter+ (not free 512MB if OOM) |

Required env:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- TTS keys used by pipeline
- `VIDEO_PUBLISH_MODE=distribute`
- `VIDEO_DELIVERY_PLATFORMS=youtube`
- `YOUTUBE_CHANNEL_ID`, `YOUTUBE_REFRESH_TOKEN`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`

Success log lines:

```
render_loop_start
🎬 BVAI video renderer
```

### C) Frontend (separate service)

| Setting | Value |
|---------|--------|
| Root Directory | `frontend` |
| Dockerfile Path | `./Dockerfile` |

### D) Agnes worker

| Setting | Value |
|---------|--------|
| Root Directory | *(empty)* |
| Dockerfile Path | `ops/render.Dockerfile` |

## Free tier note

"Your free instance will spin down with inactivity" applies to **Web** free instances. Video needs a **Background Worker** that stays up and runs the loop. 512MB often OOMs ffmpeg+Node.
