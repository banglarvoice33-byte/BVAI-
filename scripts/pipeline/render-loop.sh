#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

INTERVAL_SEC="${RENDER_LOOP_INTERVAL_SEC:-300}"
PORT="${PORT:-10000}"

if ! [[ "$INTERVAL_SEC" =~ ^[0-9]+$ ]]; then
  INTERVAL_SEC=300
fi

HEALTH_PID=""
if [[ "$PORT" =~ ^[0-9]+$ ]]; then
  node --input-type=module -e "import http from 'node:http'; http.createServer((req,res)=>{res.writeHead(200);res.end('ok\n');}).listen(Number(process.env.PORT||10000),'0.0.0.0');" &
  HEALTH_PID=$!
  echo "health_listener port=$PORT pid=$HEALTH_PID"
fi

cleanup() {
  if [[ -n "$HEALTH_PID" ]]; then kill "$HEALTH_PID" 2>/dev/null || true; fi
}
trap 'cleanup; exit 0' TERM INT
trap cleanup EXIT

echo "render_loop_start interval_sec=$INTERVAL_SEC port=$PORT"

while true; do
  set +e
  bash "$ROOT/run-bvai.sh"
  code=$?
  set -e
  echo "render_loop_cycle exit_code=$code next_sleep_sec=$INTERVAL_SEC"
  sleep "$INTERVAL_SEC" &
  wait $! || true
done
