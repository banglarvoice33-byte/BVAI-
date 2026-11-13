#!/usr/bin/env bash
# Portable Termux/Ubuntu entry point. No upgrades or deletion of failed renders.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
if [[ "${1:-}" == '--setup' ]]; then
  if command -v pkg >/dev/null 2>&1; then
    pkg install -y nodejs python ffmpeg librsvg fontconfig fontconfig-utils util-linux
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends ffmpeg librsvg2-bin fonts-noto-core python3 python3-pip util-linux
  fi
  if [[ "${PREFIX:-}" == *com.termux* ]]; then python3 -m pip install edge-tts;
  else python3 -m pip install --user --break-system-packages edge-tts; fi
  npm ci --no-audit --no-fund
  echo 'Setup complete. Merge .env.video.example into your existing .env without replacing secrets.'
  exit 0
fi
if [[ -f .env && "${BVAI_ENV_LOADED:-}" != 1 ]]; then
  exec node --env-file=.env scripts/pipeline/launch.mjs "$@"
fi
: "${SUPABASE_URL:?SUPABASE_URL missing}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing}"
# Trusted-source news needs no human gate; reporter/field content is held by the database (video_gate_basis).
# Default: distribute when platforms are configured, otherwise website. Set VIDEO_PUBLISH_MODE=review to hold every video for an editor.
if [[ -z "${VIDEO_PUBLISH_MODE:-}" ]]; then
  if [[ -n "${VIDEO_DELIVERY_PLATFORMS:-}" ]]; then VIDEO_PUBLISH_MODE=distribute; else VIDEO_PUBLISH_MODE=website; fi
fi
export VIDEO_PUBLISH_MODE
export VIDEO_REQUIRE_CAPTIONS=true
if [[ "${VIDEO_DISTRIBUTION_WORKER_ENABLED:-false}" == true ]]; then
  echo 'Disable legacy video distribution worker first; never run two independent video publishers.'; exit 1
fi
export VIDEO_DISTRIBUTION_WORKER_ENABLED=false
if [[ "${1:-}" == '--deliver-only' ]]; then
  node scripts/pipeline/delivery-worker.mjs
  exit $?
fi
for tool in node npm python3 ffmpeg ffprobe rsvg-convert flock; do
  command -v "$tool" >/dev/null || { echo "Missing $tool — run bash run-bvai.sh --setup"; exit 1; }
done
exec 9> .bvaivideo.lock
flock -n 9 || { echo 'Another local render/upload is active.'; exit 0; }
mkdir -p logs
LOG="logs/video-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
for f in generate-video.js tts-router.js voice-captions.js video-compose.mjs video-script.mjs media-sources.mjs audio-qc.mjs upload-supabase-video.mjs; do
  node --check "scripts/pipeline/$f"
done
node -e "import('@supabase/supabase-js')" >/dev/null || { echo 'Run npm ci first'; exit 1; }
if [[ "${1:-}" != '--upload-only' ]]; then
  if [[ -f temp_assets/manifest.json ]]; then
    echo 'Unfinished upload found; retry with bash run-bvai.sh --upload-only before a new render.'
    exit 1
  fi
  node scripts/pipeline/generate-video.js
  if [[ ! -f temp_assets/manifest.json ]]; then
    echo 'No video was rendered this run (no slot/eligible article, or the article was skipped). Nothing to upload.'
    exit 0
  fi
fi
node scripts/pipeline/upload-supabase-video.mjs
# Keep receipt, captions and rendered file for inspection/retry; never erase on failure.
if [[ "$VIDEO_PUBLISH_MODE" == distribute && "${VIDEO_DELIVERY_ENABLED:-true}" != false ]]; then
  node scripts/pipeline/delivery-worker.mjs
fi
echo "Render/upload stage finished. Confirm receipt and per-platform outbox status. Log: $LOG"
