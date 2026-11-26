#!/usr/bin/env bash
# Continuous video producer for Render.com Background Worker (bvai-video-renderer).
# GitHub Actions can still call run-bvai.sh once; this loop is for always-on Render.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

INTERVAL_SEC="${RENDER_LOOP_INTERVAL_SEC:-300}"
echo "{\"event\":\"render_loop_start\",\"interval_sec\":$INTERVAL_SEC,\"publish_mode\":\"${VIDEO_PUBLISH_MODE:-}\",\"platforms\":\"${VIDEO_DELIVERY_PLATFORMS:-}\"}"

while true; do
  set +e
  bash "$ROOT/run-bvai.sh"
  code=$?
  set -e
  echo "{\"event\":\"render_loop_cycle\",\"exit_code\":$code,\"next_sleep_sec\":$INTERVAL_SEC}"
  sleep "$INTERVAL_SEC"
done
