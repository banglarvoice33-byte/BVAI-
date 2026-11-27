#!/usr/bin/env bash
# Continuous video producer for Render.com
# Background Worker (bvai-video-renderer).
# GitHub Actions can still call run-bvai.sh once;
# this loop is for always-on Render.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$
{BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

INTERVAL_SEC="${
{RENDER_LOOP_INTERVAL_SEC:-300}"
if ! [[ "$INTERVAL_SEC" =~ ^[0-9]+$ ]] ||
(( INTERVAL_SEC < 1 )); then
    echo "{\"event\":\"render_loop_bad_interval\",
\"value\":\"${INTERVAL_SEC}\",
\"fallback_sec\":300}"
    INTERVAL_SEC=300
fi

# Render *Web Services* must bind $PORT,
otherwise the deploy is killed with
# "Port scan timeout reached, no open ports
detected". Background Workers do not get PORT,
so this stays off there.
# NOTE: a free Web Service still spins down after
idle inbound traffic; only a Background Worker is
always-on.
HEALTH_PID=""
PORT="${PORT:-10000}"
if [[ -n "${PORT:-}" ]]; then
    if [[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1
&& PORT <= 65535 )); then
        node --input-type=module -e '
        import http from "node:http";
        const port = Number(process.env.PORT || 10000);
        http.createServer((req, res) => {
            res.writeHead(200, { "content-type": "text/
plain; charset=utf-8", "cache-control":
"no-store" });
            res.end("ok\n");
        }).listen(port, "0.0.0.0");
        ' &
        HEALTH_PID=$!
        echo "{\"event\":\"render_loop_health_listener\",
\"port\":$PORT}"
    else
        echo "{\"event\":\"render_loop_bad_port\",
\"value\":\"$PORT\"}"
    fi
fi

cleanup() {
    if [[ -n "$HEALTH_PID" ]]; then kill
"$HEALTH_PID" 2>/dev/null || true; fi
}
# Render sends SIGTERM on redeploy: exit
promptly instead of finishing a long sleep.
trap 'cleanup; exit 0' TERM INT
trap cleanup EXIT

echo "{\"event\":\"render_loop_start\",
\"interval_sec\":$INTERVAL_SEC,
\"publish_mode\":\"${VIDEO_PUBLISH_MODE:-}\",
\"platforms\":\"${
{VIDEO_DELIVERY_PLATFORMS:-}\"}"

while true; do
    set +e
    bash "$ROOT/run-bvai.sh"
    code=$?
    set -e
    echo "{\"event\":\"render_loop_cycle\",
\"exit_code\":$code,\"next_sleep_sec\":
$INTERVAL_SEC}"
    # `sleep & wait` lets the TERM trap fire
    immediately (a foreground sleep would delay it).
    sleep "$INTERVAL_SEC" &
    wait $! || true
done
