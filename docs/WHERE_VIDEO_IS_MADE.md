# Where video is actually made (evidence)

## Two producers

| Producer | Host | Entry |
|----------|------|--------|
| BVAI Reviewed Media Pipeline | **GitHub Actions** ubuntu-24.04 | `video-render.yml` → `run-bvai.sh` |
| bvai-video-renderer | **Render.com** Background Worker | `deploy/video-renderer.Dockerfile` → `render-loop.sh` |
| bvai-worker | **Render.com** | Agnes `ops/worker` (separate queue) |

## Proof (2026-11-26)

Run: https://github.com/banglarvoice33-byte/BVAI-/actions/runs/45832606770

- Runner: **GitHub Actions**, not Render
- Render confirmed 9.3 MB / 68.6 s
- Website video_id `46a875c7-fec1-4783-aca0-d7ff21e07cb7` completed
- YouTube delivery: dead_letter Provider HTTP 400 (after render)

## Render not building

Render only runs if the Background Worker service exists and deploys this Dockerfile. `render.yaml` alone does not create a service until Blueprint is applied in the Render dashboard.

After deploy, logs must show `render_loop_start`.

## Free 512 MB

Insufficient for ffmpeg + Node compose. Use Starter+ for `bvai-video-renderer`.
