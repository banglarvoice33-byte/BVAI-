#!/usr/bin/env bash
# Backward-compatible path; one canonical runner, no implicit public upload.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
case "${1:-}" in
  --public|--unlisted|--latest)
    echo 'Legacy publish flags are retired. Set VIDEO_PUBLISH_MODE and explicit delivery targets in .env.' >&2
    exit 2;;
esac
exec bash "$ROOT/run-bvai.sh" "$@"
