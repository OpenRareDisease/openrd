#!/usr/bin/env bash
#
# Postgres backup for the openrd platform.
#
# This database is the only copy of every FSHD patient's measurements,
# functional tests, uploaded-report metadata, consent history and the
# medical knowledge corpus (kb_chunks). It lives on one unreplicated
# Docker named volume (`pg-data` in docker-compose.yml). Before this
# script existed, the entire backup story was two prose lines in a
# per-release runbook telling an operator to type `pg_dump` by hand —
# so a host disk failure or a stray `docker volume rm` between releases
# destroyed everything with no recovery path.
#
# Usage:
#   npm run db:backup                       # dump to ./backups
#   BACKUP_DIR=/mnt/offsite npm run db:backup
#   RETENTION_DAYS=30 npm run db:backup
#
# Environment:
#   DATABASE_URL    required. Same value the api uses. `npm run
#                   db:backup` loads it from .env via --env-file-if-exists.
#   BACKUP_DIR      where dumps land. Default ./backups.
#   RETENTION_DAYS  delete dumps older than this. Default 14. Set to 0
#                   to keep everything.
#   MIN_KB_CHUNKS   fail the backup if kb_chunks holds fewer rows than
#                   this. Default 1 — a dump of an empty corpus looks
#                   like a valid backup and is not one.
#
# Scheduling: this is a plain script on purpose, so it can be driven by
# host cron, a systemd timer, or a CI job without dragging a scheduler
# into the compose stack. Example host crontab entry (03:15 daily):
#
#   15 3 * * * cd /srv/openrd && BACKUP_DIR=/mnt/offsite/openrd \
#     npm run db:backup >> /var/log/openrd-backup.log 2>&1
#
# BACKUP_DIR MUST point off-host to be worth anything. A dump sitting on
# the same disk as pg-data survives exactly the failure modes that were
# never the problem.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MIN_KB_CHUNKS="${MIN_KB_CHUNKS:-1}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found on PATH. Install the postgresql-client package matching the server version (16)."
command -v psql >/dev/null 2>&1 || fail "psql not found on PATH (needed for the pre-dump row-count check)."

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set. Run via 'npm run db:backup' so .env is loaded, or export it yourself."

# pg_dump and psql both accept a connection URI as their sole argument.
# Keeping the credential in the URI (rather than splitting it into
# PGUSER/PGPASSWORD) means it never lands in the process table as a
# separate, more greppable argument than it already is.
DB_URI="$DATABASE_URL"

# --- pre-flight: is there anything worth dumping ------------------------
#
# A backup of an empty database is the most dangerous artifact this
# script can produce: it is the right size to look plausible in a
# listing and it will happily restore over a working database. Two
# cheap assertions catch the realistic versions of that.
CORE_ROWS="$(psql "$DB_URI" -tAc "SELECT count(*) FROM app_users" 2>/dev/null || echo "ERR")"
[ "$CORE_ROWS" = "ERR" ] && fail "cannot query app_users — is DATABASE_URL pointing at the migrated openrd database?"

KB_ROWS="$(psql "$DB_URI" -tAc "SELECT count(*) FROM kb_chunks" 2>/dev/null || echo "ERR")"
[ "$KB_ROWS" = "ERR" ] && fail "cannot query kb_chunks — migration 006 has not run against this database."

if [ "$KB_ROWS" -lt "$MIN_KB_CHUNKS" ]; then
  # kb_chunks is not reconstructible from anything else in the repo:
  # the 547 MB source corpus is gitignored and lives on one laptop, so
  # a dump taken while the table is empty silently drops the only
  # server-side copy out of the backup rotation.
  fail "kb_chunks holds $KB_ROWS rows (minimum $MIN_KB_CHUNKS). Refusing to record an empty knowledge base as a good backup. Re-run the ingest, or set MIN_KB_CHUNKS=0 if you really are backing up a corpus-less environment."
fi

mkdir -p "$BACKUP_DIR"

# The default BACKUP_DIR is inside the working tree, and these dumps
# contain every patient's records. Drop a self-ignoring .gitignore in
# there the moment the directory is used, so a dump can never be picked
# up by `git add -A` — a nested .gitignore is honoured by git and does
# not require an edit to the repo-root one that somebody would have to
# remember to make.
case "$BACKUP_DIR" in
  "$REPO_ROOT"/*)
    if [ ! -f "$BACKUP_DIR/.gitignore" ]; then
      printf '# Postgres dumps contain patient records. Never commit them.\n*\n!.gitignore\n' \
        >"$BACKUP_DIR/.gitignore"
    fi
    ;;
esac

STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
DB_NAME="$(printf '%s' "$DB_URI" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')"
DUMP_PATH="$BACKUP_DIR/openrd-${DB_NAME}-${STAMP}.dump"
TMP_PATH="$DUMP_PATH.partial"

log "dumping $DB_NAME (app_users=$CORE_ROWS, kb_chunks=$KB_ROWS) -> $DUMP_PATH"

# Custom format (-Fc): compressed, and restorable selectively with
# pg_restore. Plain SQL would be ~10x larger because of the 1024-dim
# kb_chunks embeddings and could only be replayed whole.
#
# Writing to .partial first and renaming on success is what keeps a
# backup killed mid-write (OOM, cron timeout, host reboot) from sitting
# in the directory looking like a complete dump. The restore script
# only ever sees files that finished.
if ! pg_dump --format=custom --no-owner --no-privileges --file="$TMP_PATH" "$DB_URI"; then
  rm -f "$TMP_PATH"
  fail "pg_dump failed; no backup was written."
fi

mv "$TMP_PATH" "$DUMP_PATH"

# Verify the archive is readable before we let retention delete an older
# one on the strength of it. `pg_restore --list` parses the whole table
# of contents without touching a database.
if ! pg_restore --list "$DUMP_PATH" >/dev/null 2>&1; then
  fail "wrote $DUMP_PATH but pg_restore could not read it back. Keeping the file for inspection; older backups were NOT pruned."
fi

# TABLE DATA entries, not "tables that have rows" — pg_restore lists one
# per dumped table regardless of row count. It is a shape check (did the
# dump capture the whole schema), not a fullness check; the row counts
# above are what say whether there is anything in it.
TOC_TABLES="$(pg_restore --list "$DUMP_PATH" | grep -c 'TABLE DATA' || true)"
log "wrote $DUMP_PATH ($(du -h "$DUMP_PATH" | cut -f1), $TOC_TABLES TABLE DATA entries)"

# --- retention ----------------------------------------------------------
if [ "$RETENTION_DAYS" -gt 0 ]; then
  # -mtime +N is "older than N days" in whole days, which is what a
  # daily schedule wants. Restricted to this script's own filename shape
  # so pointing BACKUP_DIR at a shared directory cannot delete anything
  # that is not ours.
  PRUNED=0
  while IFS= read -r old; do
    log "pruning $old (older than ${RETENTION_DAYS}d)"
    rm -f "$old"
    PRUNED=$((PRUNED + 1))
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'openrd-*.dump' -mtime "+$RETENTION_DAYS")
  log "retention: kept $(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'openrd-*.dump' | wc -l | tr -d ' ') dump(s), pruned $PRUNED"
fi

log "backup complete"
