#!/usr/bin/env bash
# Explicit local opt-in. Never run together with the GitHub video scheduler.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if [[ "${1:-}" != --install ]]; then
  echo 'No cron changed. For an always-awake Termux host ONLY: set BVAI_VIDEO_SCHEDULER_OWNER=termux and ENABLE_VIDEO_AUTOMATION=true in .env, disable GitHub rendering, then pass --install.'
  exit 0
fi
command -v crontab >/dev/null || { echo 'Install cronie and enable the crond service first.' >&2; exit 1; }
node --env-file=.env --input-type=module -e "if(process.env.BVAI_VIDEO_SCHEDULER_OWNER!=='termux'||process.env.ENABLE_VIDEO_AUTOMATION!=='true')process.exit(2)"
# Quote paths, reject line breaks/single quotes rather than generate unsafe shell code.
[[ "$ROOT" != *"'"* && "$ROOT" != *$'\n'* ]] || { echo 'Unsupported directory name'; exit 1; }
NODE="$(command -v node)"
mkdir -p .local-backups logs
(crontab -l 2>/dev/null || true) > .local-backups/crontab-before-bvai.txt
TMPFILE="$(mktemp)"; trap 'rm -f "$TMPFILE"' EXIT
{ grep -v 'banglar-voice-pipeline' .local-backups/crontab-before-bvai.txt || true
  printf "* * * * * cd '%s' && '%s' --env-file=.env scripts/pipeline/local-slot.mjs >> '%s/logs/local-scheduler.log' 2>&1 # banglar-voice-pipeline\n" "$ROOT" "$NODE" "$ROOT"
} > "$TMPFILE"
crontab "$TMPFILE"
echo 'Installed local-only Dhaka slot dispatcher. crond, Android uptime/wake-lock and battery exclusions must be verified on the actual phone.'
