#!/usr/bin/env bash
# Local encrypted backup, not a public GitHub artifact. Requires pg_dump + age.
set -euo pipefail
: "${SUPABASE_DB_URL:?Set new database session-pooler URL}"
: "${BACKUP_AGE_RECIPIENT:?Set age public recipient key}"
command -v pg_dump >/dev/null
command -v age >/dev/null
umask 077
mkdir -p backups
FILE="backups/database-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-acl | age -r "$BACKUP_AGE_RECIPIENT" > "$FILE"
test -s "$FILE"
printf 'Encrypted database backup: %s\n' "$FILE"
# Storage object bytes are NOT part of this dump. Back them up separately.
