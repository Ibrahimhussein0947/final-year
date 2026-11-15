#!/usr/bin/env bash
# Backs up the database (pg_dump, custom format) and the uploaded files of the production compose stack.
#   infra/backup/backup.sh            -> infra/backups/<UTC timestamp>/{db.dump,uploads.tar.gz,SHA256SUMS}
# Environment: KEEP=14 (how many backups to keep), BACKUP_DIR (default infra/backups).
# Run it from cron or a systemd timer, and COPY the result off the server: a backup on the same disk is not a backup.
set -euo pipefail
export MSYS_NO_PATHCONV=1

HERE="$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })"  # pwd -W: Windows-style path for Docker Desktop under Git Bash
INFRA="$(dirname "$HERE")"
COMPOSE=(docker compose -f "$INFRA/docker-compose.prod.yml" --env-file "$INFRA/.env.prod")
BACKUP_DIR="${BACKUP_DIR:-$INFRA/backups}"
KEEP="${KEEP:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/$STAMP"
mkdir -p "$OUT"

echo "Dumping database..."
"${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT/db.dump"

echo "Archiving uploads..."
"${COMPOSE[@]}" exec -T api tar -czf - -C /data uploads > "$OUT/uploads.tar.gz"

# Refuse to call it a backup if either file is empty or unreadable.
[ -s "$OUT/db.dump" ] || { echo "ERROR: database dump is empty" >&2; rm -rf "$OUT"; exit 1; }
gzip -t "$OUT/uploads.tar.gz" || { echo "ERROR: uploads archive is corrupt" >&2; rm -rf "$OUT"; exit 1; }
(cd "$OUT" && sha256sum db.dump uploads.tar.gz > SHA256SUMS)

# Keep the newest $KEEP backups.
ls -1d "$BACKUP_DIR"/*/ 2>/dev/null | sort | head -n -"$KEEP" | xargs -r rm -rf

echo "Backup written to $OUT"
