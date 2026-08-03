#!/usr/bin/env bash
#
# Restore an openrd Postgres backup produced by scripts/db-backup.sh.
#
# A backup nobody has ever restored is a hypothesis, not a backup. This
# script exists so the restore is a rehearsed, scripted step rather than
# something improvised at 3am against the only copy of every patient's
# medical history.
#
# Usage:
#   npm run db:restore -- backups/openrd-fshd_openrd-20260801T031500Z.dump
#   npm run db:restore -- <dump> --into postgres://…/openrd_restore_drill
#   npm run db:restore -- <dump> --force        # overwrite a NON-empty target
#   npm run db:restore -- <dump> --list         # inspect, restore nothing
#
# Environment:
#   DATABASE_URL   default restore target. `npm run db:restore` loads it
#                  from .env. --into overrides it.
#
# Whichever of the two is used, the URI is parsed into PGHOST/PGUSER/
# PGPASSWORD/PGDATABASE before any client runs, so the password never
# appears in argv and therefore never in /proc/<pid>/cmdline. See
# scripts/lib/pg-connect-env.sh for why that matters more here than
# anywhere else: a restore is the longest-running command in the repo.
#
# THE --force GATE
# ----------------
# Without --force this refuses any target that already holds application
# rows. That is the whole safety model: the overwhelmingly common
# mistake is running a restore against production while meaning to run
# it against a drill database, and pg_restore's own --clean would carry
# that out without comment. Practice restores go to a fresh empty
# database and never need the flag; the one time you legitimately do
# need it, you are already certain, and typing it is cheap.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}

# shellcheck source=lib/pg-connect-env.sh
. "$SCRIPT_DIR/lib/pg-connect-env.sh"

DUMP_PATH=""
TARGET_URL="${DATABASE_URL:-}"
FORCE=0
LIST_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --into)
      [ $# -ge 2 ] || fail "--into needs a connection URI"
      TARGET_URL="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    -*)
      fail "unknown option $1"
      ;;
    *)
      [ -z "$DUMP_PATH" ] || fail "more than one dump file given ($DUMP_PATH and $1)"
      DUMP_PATH="$1"
      shift
      ;;
  esac
done

command -v pg_restore >/dev/null 2>&1 || fail "pg_restore not found on PATH. Install the postgresql-client package matching the server version (16)."
command -v psql >/dev/null 2>&1 || fail "psql not found on PATH (needed for the emptiness check)."

[ -n "$DUMP_PATH" ] || fail "no dump file given. Usage: npm run db:restore -- <dump> [--into URI] [--force]"
[ -f "$DUMP_PATH" ] || fail "$DUMP_PATH does not exist"

pg_restore --list "$DUMP_PATH" >/dev/null 2>&1 || fail "$DUMP_PATH is not a readable pg_dump custom-format archive."

if [ "$LIST_ONLY" -eq 1 ]; then
  pg_restore --list "$DUMP_PATH"
  exit 0
fi

[ -n "$TARGET_URL" ] || fail "no restore target. Set DATABASE_URL (npm run db:restore loads .env) or pass --into."

# Puts the credential in PGPASSWORD rather than in argv. `pg_restore
# --dbname="$URI"` published the production password in
# /proc/<pid>/cmdline — world readable on a stock Linux host — for the
# whole duration of a restore, which is the slowest operation in this
# repo. See scripts/lib/pg-connect-env.sh.
#
# It also gives us a credential-free description for free. The old
# sed-based masking only stripped a `user:pass@` authority; a URI whose
# password appeared anywhere else (a `password=` query parameter, a
# path-less URI) was printed verbatim into output that routinely ends up
# pasted into an incident channel.
pg_use_connection_uri "$TARGET_URL" "the restore target" || exit 1
TARGET_DESC="$PG_DESC"

psql -tAc 'SELECT 1' >/dev/null 2>&1 || fail "cannot connect to $TARGET_DESC"

# --- emptiness gate -----------------------------------------------------
#
# "Empty" means no application rows, not no tables: a target that has
# been migrated but never used is a perfectly good restore destination
# and refusing it would push people straight to --force, which defeats
# the gate. So count rows in the tables that hold irreplaceable data.
EXISTING=0
for table in app_users patient_profiles patient_measurements patient_function_tests patient_documents kb_chunks; do
  n="$(psql -tAc "SELECT count(*) FROM $table" 2>/dev/null || echo 0)"
  EXISTING=$((EXISTING + n))
done

if [ "$EXISTING" -gt 0 ] && [ "$FORCE" -eq 0 ]; then
  fail "$TARGET_DESC already holds $EXISTING application rows. Restoring would drop and replace them. Restore into a fresh database with --into, or re-run with --force if you are deliberately overwriting this one."
fi

if [ "$EXISTING" -gt 0 ]; then
  log "WARNING: --force given; $TARGET_DESC holds $EXISTING application rows and they are about to be replaced."
fi

log "restoring $DUMP_PATH -> $TARGET_DESC"

# --clean --if-exists so a --force restore replaces objects instead of
# colliding with them. --no-owner/--no-privileges because the dump was
# taken without them and the target role differs between the compose
# stack (postgres) and a managed provider.
#
# NOT --single-transaction: pgvector's HNSW index build on kb_chunks is
# the slowest step by far, and wrapping ~10k embeddings plus the index
# in one transaction is where a large restore runs the target out of
# memory. Errors are surfaced by --exit-on-error instead, which stops at
# the first failure and leaves the partial state visible for diagnosis
# rather than silently rolling back the evidence.
if ! pg_restore \
  --dbname="$PGDATABASE" \
  --clean --if-exists \
  --no-owner --no-privileges \
  --exit-on-error \
  "$DUMP_PATH"; then
  fail "pg_restore failed. The target is in a partially-restored state — do NOT point the api at it. Fix the reported error and re-run with --force."
fi

log "restore finished; verifying"

for table in app_users patient_profiles patient_measurements patient_function_tests kb_chunks schema_migrations; do
  n="$(psql -tAc "SELECT count(*) FROM $table" 2>/dev/null || echo '?')"
  log "  $table: $n rows"
done

# The ledger has to come back with the data. A restore that loses
# schema_migrations leaves the next api boot re-running every migration
# against an already-migrated schema, which dies on 42710/42P07 and
# crash-loops the container.
LEDGER="$(psql -tAc 'SELECT count(*) FROM schema_migrations' 2>/dev/null || echo 0)"
[ "$LEDGER" -gt 0 ] || fail "schema_migrations is empty after the restore. Do not start the api against this database — it would try to re-apply every migration."

log "restore complete. Run 'npm run db:migrate:status' against the target before starting the api."
