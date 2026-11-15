#!/usr/bin/env bash
# Restores a backup made by backup.sh.
#   infra/backup/restore.sh <backup-dir>                     restore into a NEW scratch database "restore_check" (safe: nothing is overwritten)
#   infra/backup/restore.sh <backup-dir> --in-place          REPLACE the live database and uploads (stop the api first; asks you to type the database name)
# Test your backups regularly with the safe form: an untested backup is a hope, not a backup.
set -euo pipefail
export MSYS_NO_PATHCONV=1

[ $# -ge 1 ] || { sed -n 2,6p "$0"; exit 2; }
SRC="$1"; MODE="${2:-check}"
HERE="$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })"  # pwd -W: Windows-style path for Docker Desktop under Git Bash
INFRA="$(dirname "$HERE")"
COMPOSE=(docker compose -f "$INFRA/docker-compose.prod.yml" --env-file "$INFRA/.env.prod")

[ -f "$SRC/db.dump" ] || { echo "No db.dump in $SRC" >&2; exit 1; }
(cd "$SRC" && sha256sum -c SHA256SUMS) || { echo "Checksum mismatch: this backup is damaged." >&2; exit 1; }

if [ "$MODE" = "--in-place" ]; then
  DB="$("${COMPOSE[@]}" exec -T db sh -c 'echo -n "$POSTGRES_DB"')"
  echo "This will ERASE the live database '$DB' and the uploaded files and replace them with the backup."
  read -r -p "Type the database name to continue: " ANSWER
  [ "$ANSWER" = "$DB" ] || { echo "Cancelled."; exit 1; }
  "${COMPOSE[@]}" stop api web
  "${COMPOSE[@]}" exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$SRC/db.dump"
  "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint "" -v "$(cd "$SRC" && pwd):/backup:ro" api sh -c 'rm -rf /data/uploads/* && tar -xzf /backup/uploads.tar.gz -C /data' 2>/dev/null \
    || echo "NOTE: restore the uploads archive into the 'uploads' volume manually: tar -xzf uploads.tar.gz -C <volume>/.."
  "${COMPOSE[@]}" up -d
  echo "Restored in place."
else
  echo "Restoring into scratch database restore_check ..."
  "${COMPOSE[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check"'
  "${COMPOSE[@]}" exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner' < "$SRC/db.dump"
  echo "Row counts in the restored copy:"
  "${COMPOSE[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_check -tAc "select '"'"'users'"'"', count(*) from \"User\" union all select '"'"'jobs'"'"', count(*) from \"Job\" union all select '"'"'applications'"'"', count(*) from \"Application\" union all select '"'"'skills'"'"', count(*) from \"Skill\""'
  echo "Uploads archive lists $(tar -tzf "$SRC/uploads.tar.gz" | grep -c -v '/$') file(s)."
  echo "Drop the scratch database with: docker compose ... exec db psql -U <user> -d postgres -c 'DROP DATABASE restore_check'"
fi
