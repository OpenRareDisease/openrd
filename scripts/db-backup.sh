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
#   BACKUP_DIR      where dumps land. Default ./backups. MUST be
#                   absolute; see the BACKUP_DIR section below.
#   RETENTION_DAYS  delete dumps older than this. Default 14. Set to 0
#                   to keep everything.
#   MIN_KB_CHUNKS   fail the backup if kb_chunks holds fewer rows than
#                   this. Default 1 — a dump of an empty corpus looks
#                   like a valid backup and is not one.
#   MIN_APP_USERS   fail the backup if app_users holds fewer rows than
#                   this. Default 1 — same reasoning, for the table
#                   every patient record hangs off.
#   ALLOWED_ROW_DROP_PCT
#                   how much the live row counts may fall below the
#                   previous dump's before this refuses. Default 10.
#   ALLOW_ROW_COUNT_DROP=1
#                   one-shot override for a legitimate large drop (a
#                   bulk erasure request, a deliberate corpus rebuild).
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
#
# WHAT THE PRE-FLIGHT IS FOR
# --------------------------
# The dangerous artifact is not a corrupt dump — pg_restore rejects
# those. It is a *plausible* dump of the wrong database: right size,
# right shape, restores cleanly, and holds nobody's records. Because
# retention then prunes on the strength of it, a single run against an
# empty database quietly starts a 14-day countdown at the end of which
# every dump that still had patients in it is gone.
#
# So the pre-flight is comparative, not just presence-based. Each dump
# writes a `.dump.meta` sidecar with the row counts it captured, and the
# next run reads the newest one: a live database that has fewer rows
# than the last dump recorded is the signal that DATABASE_URL moved, and
# it stops the run before pg_dump is invoked. Retention is gated on the
# same comparison, so even a run that is forced through cannot delete
# history behind itself.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MIN_KB_CHUNKS="${MIN_KB_CHUNKS:-1}"
MIN_APP_USERS="${MIN_APP_USERS:-1}"
ALLOWED_ROW_DROP_PCT="${ALLOWED_ROW_DROP_PCT:-10}"
ALLOW_ROW_COUNT_DROP="${ALLOW_ROW_COUNT_DROP:-0}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

# shellcheck source=lib/pg-connect-env.sh
. "$SCRIPT_DIR/lib/pg-connect-env.sh"

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found on PATH. Install the postgresql-client package matching the server version (16)."
command -v psql >/dev/null 2>&1 || fail "psql not found on PATH (needed for the pre-dump row-count check)."

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set. Run via 'npm run db:backup' so .env is loaded, or export it yourself."

# Puts the credential in PGPASSWORD (owner-readable /proc/<pid>/environ)
# instead of in argv (world-readable /proc/<pid>/cmdline), and derives
# PGDATABASE by parsing the URI rather than by regex, so a URI with no
# path component fails loudly here instead of writing the password into
# the dump filename. See scripts/lib/pg-connect-env.sh.
pg_use_connection_uri "$DATABASE_URL" DATABASE_URL || exit 1
DB_NAME="$PGDATABASE"

# --- BACKUP_DIR must be absolute ----------------------------------------
#
# `BACKUP_DIR=backups npm run db:backup` used to resolve relative to the
# repo root (package.json spawns bash from there with no cd), create
# <repo>/backups, and then MISS the self-ignoring .gitignore below,
# because that guard matched on the "$REPO_ROOT"/* glob and a relative
# path never matches it. The repo-root .gitignore has no backups entry,
# so the next `git add -A && git commit && git push` published a
# pg_dump of every patient's records to a public GitHub org.
#
# Refusing outright rather than silently canonicalising: a relative
# BACKUP_DIR means the operator has a different directory in mind than
# the one they will get, and the whole header of this file is about the
# dump landing somewhere deliberate. The error names the absolute path
# they probably meant so the fix is a copy-paste.
case "$BACKUP_DIR" in
  /*) ;;
  *)
    fail "BACKUP_DIR must be an absolute path, got '$BACKUP_DIR'. A relative path resolves against whatever directory this happens to be spawned from — which for 'npm run db:backup' is the repo root, i.e. PHI dumps inside the working tree. Did you mean BACKUP_DIR=$(cd "$(dirname "$BACKUP_DIR")" 2>/dev/null && pwd || printf '%s' "$PWD")/$(basename "$BACKUP_DIR") ?"
    ;;
esac

mkdir -p "$BACKUP_DIR"
# Canonicalise after the mkdir: the directory is guaranteed to exist by
# now, so `cd && pwd` resolves symlinks and any `..` segments and the
# in-tree test below sees the same string git would.
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

# These dumps contain every patient's records. Drop a self-ignoring
# .gitignore in there the moment the directory is used, so a dump can
# never be picked up by `git add -A` — a nested .gitignore is honoured
# by git and does not require an edit to the repo-root one that somebody
# would have to remember to make. This is belt to the braces of the
# absolute-path rule above, and it is written on every run rather than
# only on the first, so a directory populated by an older version of
# this script gets covered too.
case "$BACKUP_DIR" in
  "$REPO_ROOT"/*)
    log "WARNING: BACKUP_DIR is inside the working tree ($BACKUP_DIR). Dropping a self-ignoring .gitignore, but a dump on the same disk as pg-data is not a backup — point BACKUP_DIR off-host."
    if [ ! -f "$BACKUP_DIR/.gitignore" ]; then
      printf '# Postgres dumps contain patient records. Never commit them.\n*\n!.gitignore\n' \
        >"$BACKUP_DIR/.gitignore"
    fi
    ;;
esac

# --- previous-dump manifest ---------------------------------------------
#
# Stamps are UTC and zero-padded, so lexicographic order over the
# sidecar filenames is chronological order. Newest wins.
newest_manifest() {
  # `|| true` because `set -o pipefail` would otherwise turn "no
  # manifests yet" (the first ever run) into a fatal pipeline failure.
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'openrd-*.dump.meta' 2>/dev/null |
    LC_ALL=C sort | tail -n 1 || true
}

manifest_value() {
  # $1 key, $2 manifest path. Prints nothing when absent, so callers can
  # distinguish "no baseline" from "baseline of 0".
  [ -f "$2" ] || return 0
  awk -F= -v key="$1" '$1 == key { print $2; exit }' "$2"
}

# Integer floor a count may not fall below, rounded UP so a baseline of
# 1 can never be satisfied by 0.
drop_floor() {
  local previous="$1"
  printf '%s' $(((previous * (100 - ALLOWED_ROW_DROP_PCT) + 99) / 100))
}

# Read the baseline into variables ONCE, here, before anything is
# written. Re-reading the file later would be a trap: two runs inside
# the same second produce the same STAMP and therefore the same
# manifest path, so a retention check that re-read from disk would end
# up comparing the new dump against itself and always pass.
PREV_MANIFEST="$(newest_manifest)"
PREV_DB="$(manifest_value database "$PREV_MANIFEST")"
PREV_USERS="$(manifest_value app_users "$PREV_MANIFEST")"
PREV_KB="$(manifest_value kb_chunks "$PREV_MANIFEST")"
PREV_BYTES="$(manifest_value bytes "$PREV_MANIFEST")"

# --- pre-flight: is there anything worth dumping ------------------------
#
# A backup of an empty database is the most dangerous artifact this
# script can produce: it is the right size to look plausible in a
# listing and it will happily restore over a working database. Three
# assertions catch the realistic versions of that — the two tables can
# be queried at all, each holds at least its minimum, and neither has
# fallen below what the previous dump recorded.
CORE_ROWS="$(psql -tAc "SELECT count(*) FROM app_users" 2>/dev/null || echo "ERR")"
[ "$CORE_ROWS" = "ERR" ] && fail "cannot query app_users on $PG_DESC — is DATABASE_URL pointing at the migrated openrd database?"

KB_ROWS="$(psql -tAc "SELECT count(*) FROM kb_chunks" 2>/dev/null || echo "ERR")"
[ "$KB_ROWS" = "ERR" ] && fail "cannot query kb_chunks on $PG_DESC — migration 006 has not run against this database."

if [ "$CORE_ROWS" -lt "$MIN_APP_USERS" ]; then
  # app_users is the table every patient record hangs off, and unlike
  # kb_chunks it is reconstructible from nothing at all. This gate used
  # to be missing entirely: CORE_ROWS was compared against the literal
  # string 'ERR' and nothing else, so a dump of a freshly-created
  # restore-drill database (app_users=0, kb_chunks re-ingested) sailed
  # through, and retention then had 14 days to delete every dump that
  # still contained patients.
  fail "app_users holds $CORE_ROWS rows (minimum $MIN_APP_USERS) on $PG_DESC. Refusing to record a patient-less database as a good backup — check that DATABASE_URL is the production database and not a restore-drill or freshly-migrated one. Set MIN_APP_USERS=0 if you really are backing up an empty environment."
fi

if [ "$KB_ROWS" -lt "$MIN_KB_CHUNKS" ]; then
  # kb_chunks is not reconstructible from anything else in the repo:
  # the 547 MB source corpus is gitignored and lives on one laptop, so
  # a dump taken while the table is empty silently drops the only
  # server-side copy out of the backup rotation.
  fail "kb_chunks holds $KB_ROWS rows (minimum $MIN_KB_CHUNKS). Refusing to record an empty knowledge base as a good backup. Re-run the ingest, or set MIN_KB_CHUNKS=0 if you really are backing up a corpus-less environment."
fi

# Comparative gate. A fixed minimum of 1 catches the empty database; it
# does not catch DATABASE_URL moving from the 400-patient production
# database to a 2-row staging one, which looks identical to every
# presence check in this file.
if [ -n "$PREV_MANIFEST" ] && [ "$ALLOW_ROW_COUNT_DROP" != "1" ]; then
  if [ -n "$PREV_DB" ] && [ "$PREV_DB" != "$DB_NAME" ]; then
    fail "the newest dump in $BACKUP_DIR was taken from database '$PREV_DB' but DATABASE_URL now points at '$DB_NAME' ($PG_DESC). Mixing two databases in one BACKUP_DIR makes retention prune across them. Use a separate BACKUP_DIR per database, or set ALLOW_ROW_COUNT_DROP=1 if this is a deliberate rename."
  fi

  if [ -n "$PREV_USERS" ] && [ "$CORE_ROWS" -lt "$(drop_floor "$PREV_USERS")" ]; then
    fail "app_users has $CORE_ROWS rows but the previous dump ($(basename "${PREV_MANIFEST%.meta}")) recorded $PREV_USERS — a drop of more than ${ALLOWED_ROW_DROP_PCT}%. This is what a repointed DATABASE_URL looks like. Verify the target, then re-run with ALLOW_ROW_COUNT_DROP=1 if the drop is real (a bulk erasure request)."
  fi

  if [ -n "$PREV_KB" ] && [ "$KB_ROWS" -lt "$(drop_floor "$PREV_KB")" ]; then
    fail "kb_chunks has $KB_ROWS rows but the previous dump ($(basename "${PREV_MANIFEST%.meta}")) recorded $PREV_KB — a drop of more than ${ALLOWED_ROW_DROP_PCT}%. Re-run with ALLOW_ROW_COUNT_DROP=1 if you are mid-way through a deliberate corpus rebuild."
  fi
fi

STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
DUMP_PATH="$BACKUP_DIR/openrd-${DB_NAME}-${STAMP}.dump"
TMP_PATH="$DUMP_PATH.partial"

# The stamp has one-second resolution, so two runs in the same second
# resolve to the same path. Overwriting silently would destroy a good
# dump and — worse — replace the manifest the comparative gates read,
# which is how a bad dump could end up validated against itself.
if [ -e "$DUMP_PATH" ]; then
  fail "$DUMP_PATH already exists. Two backups landed in the same second; wait one second and re-run rather than overwriting a dump that has already been verified."
fi

log "dumping $DB_NAME from $PG_DESC (app_users=$CORE_ROWS, kb_chunks=$KB_ROWS) -> $DUMP_PATH"

# Custom format (-Fc): compressed, and restorable selectively with
# pg_restore. Plain SQL would be ~10x larger because of the 1024-dim
# kb_chunks embeddings and could only be replayed whole.
#
# No connection argument: the credential is in PGPASSWORD, see the
# pg_use_connection_uri call above.
#
# Writing to .partial first and renaming on success is what keeps a
# backup killed mid-write (OOM, cron timeout, host reboot) from sitting
# in the directory looking like a complete dump. The restore script
# only ever sees files that finished.
if ! pg_dump --format=custom --no-owner --no-privileges --file="$TMP_PATH"; then
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
DUMP_BYTES="$(wc -c <"$DUMP_PATH" | tr -d ' ')"
log "wrote $DUMP_PATH ($(du -h "$DUMP_PATH" | cut -f1), $TOC_TABLES TABLE DATA entries)"

# The sidecar is what makes the next run's pre-flight comparative rather
# than presence-based. Written only after the archive has been read
# back, so a manifest never describes a dump that failed verification.
cat >"$DUMP_PATH.meta" <<META
database=$DB_NAME
stamp=$STAMP
app_users=$CORE_ROWS
kb_chunks=$KB_ROWS
toc_table_data=$TOC_TABLES
bytes=$DUMP_BYTES
META

# --- retention ----------------------------------------------------------
if [ "$RETENTION_DAYS" -gt 0 ]; then
  # Retention is the only destructive thing this script does, so it gets
  # its own gate rather than trusting the pre-flight to have caught
  # everything. The pre-flight can be overridden (ALLOW_ROW_COUNT_DROP)
  # and the override is exactly the moment an operator is least likely
  # to also want history deleted behind them.
  PRUNE_BLOCKED=""
  if [ -n "$PREV_MANIFEST" ]; then
    if [ -n "$PREV_USERS" ] && [ "$CORE_ROWS" -lt "$PREV_USERS" ]; then
      # Any decrease at all, not the pre-flight's percentage tolerance:
      # keeping an extra fortnight of dumps costs disk, deleting the
      # last dump that still had a patient in it costs the patient.
      PRUNE_BLOCKED="the new dump holds $CORE_ROWS app_users, fewer than the previous dump's $PREV_USERS"
    elif [ -n "$PREV_BYTES" ] && [ "$PREV_BYTES" -gt 0 ] &&
      [ "$DUMP_BYTES" -lt $((PREV_BYTES * 60 / 100)) ]; then
      # Size is the backstop for everything the row counts do not see —
      # a dump that lost patient_documents, or the kb_chunks embeddings,
      # while app_users stayed intact. 60% because these archives are
      # compressed and a normal day-to-day delta is single-digit percent.
      PRUNE_BLOCKED="the new dump is $DUMP_BYTES bytes, under 60% of the previous dump's $PREV_BYTES"
    fi
  fi

  if [ -n "$PRUNE_BLOCKED" ]; then
    log "retention SKIPPED: $PRUNE_BLOCKED. Nothing was pruned. Inspect $DUMP_PATH before the next run, because a second implausible dump would become the baseline this compares against."
  else
    # -mtime +N is "older than N days" in whole days, which is what a
    # daily schedule wants. Restricted to this script's own filename
    # shape so pointing BACKUP_DIR at a shared directory cannot delete
    # anything that is not ours. The .meta sidecar goes with its dump —
    # an orphaned manifest would become a phantom baseline.
    PRUNED=0
    while IFS= read -r old; do
      log "pruning $old (older than ${RETENTION_DAYS}d)"
      rm -f "$old" "$old.meta"
      PRUNED=$((PRUNED + 1))
    done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'openrd-*.dump' -mtime "+$RETENTION_DAYS")
    log "retention: kept $(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'openrd-*.dump' | wc -l | tr -d ' ') dump(s), pruned $PRUNED"
  fi
fi

log "backup complete"
