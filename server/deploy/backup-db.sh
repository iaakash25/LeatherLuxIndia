#!/usr/bin/env bash
# Nightly backup of the LLX Postgres database. Keeps the last 14 days. Install and test: deploy/README.md, "Backups".
#
# Reads the database settings from the API's own .env, so there is no second copy of the password to look after.
# Run it as root (it is installed in root's crontab): root can read the .env, and the dumps are readable by root only.
set -euo pipefail

ENV_FILE="${LLX_ENV_FILE:-/opt/llx/app/server/.env}"
DEST="${LLX_BACKUP_DIR:-/var/backups/llx}"
KEEP_DAYS="${LLX_BACKUP_KEEP_DAYS:-14}"

[ -r "$ENV_FILE" ] || { echo "cannot read $ENV_FILE" >&2; exit 1; }
# One KEY=value from the .env (the production template has no inline comments).
get() { grep -E "^$1=" "$ENV_FILE" | head -n 1 | cut -d= -f2- | tr -d '\r'; }

export PGHOST="$(get DB_HOST)" PGPORT="$(get DB_PORT)" PGDATABASE="$(get DB_NAME)" PGUSER="$(get DB_USER)" PGPASSWORD="$(get DB_PASSWORD)"
export PGSSLMODE="$(get DB_SSL_MODE)"
[ -n "$PGDATABASE" ] && [ -n "$PGUSER" ] && [ -n "$PGPASSWORD" ] || { echo "database settings missing in $ENV_FILE" >&2; exit 1; }

umask 077
mkdir -p "$DEST"
file="$DEST/llx-$(date +%Y-%m-%d_%H%M).dump"
# Written under a temporary name first, so a half-finished dump is never mistaken for a backup.
pg_dump --format=custom --no-owner --file="$file.partial"
mv "$file.partial" "$file"
find "$DEST" -name 'llx-*.dump' -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) backup written: $file ($(du -h "$file" | cut -f1))"
