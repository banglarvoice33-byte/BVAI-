#!/usr/bin/env bash
set -euo pipefail

: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a disposable PostgreSQL 17 database}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1)

"${PSQL[@]}" -f "$ROOT_DIR/supabase/tests/video_distribution_bootstrap.sql"
"${PSQL[@]}" -f "$ROOT_DIR/supabase/migrations/20261104022251_video_distribution_queue_v1.sql"
"${PSQL[@]}" -f "$ROOT_DIR/supabase/tests/video_distribution_rls.test.sql"
