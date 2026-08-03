# shellcheck shell=bash
#
# Sourceable helper: put a Postgres connection URI into the libpq
# environment variables instead of onto a command line.
#
# `psql "$URI"` / `pg_dump … "$URI"` / `pg_restore --dbname="$URI"` all
# publish the password in /proc/<pid>/cmdline, which is world readable
# on a stock Linux host — `ps auxww | grep pg_dump` during the 03:15
# cron is enough to lift the production database password out of an
# unprivileged local account. PGPASSWORD lives in /proc/<pid>/environ
# instead, which is owner-and-root only.
#
# An earlier version of both scripts argued the opposite in a comment
# («keeping the credential in the URI … means it never lands in the
# process table as a separate, more greppable argument than it already
# is»). The premise was backwards: the alternative it dismissed keeps
# the credential out of argv entirely. That comment is why this survived
# one review, so the reasoning is spelled out here rather than left
# implicit.
#
# Usage:
#   . "$SCRIPT_DIR/lib/pg-connect-env.sh"
#   pg_use_connection_uri "$DATABASE_URL" DATABASE_URL
#   psql -tAc 'SELECT 1'          # no connection argument anywhere
#   log "connected to $PG_DESC"   # credential-free description
#
# After a successful call the following are exported: PGDATABASE,
# PGHOST/PGPORT/PGUSER (when the URI carries them), PGPASSWORD (only
# when the URI carries one, so ~/.pgpass still works otherwise), the
# translated ssl*/timeout parameters, and PG_DESC for logging.

# Every libpq variable this helper owns. Listed once so the reset below
# and the export below cannot drift apart — a variable that is cleared
# but never re-exported would silently fall back to the caller's shell.
OPENRD_PG_VARS="PGDATABASE PGHOST PGPORT PGUSER PGPASSWORD PGSSLMODE PGSSLROOTCERT PGSSLCERT PGSSLKEY PGCONNECT_TIMEOUT PGAPPNAME PGOPTIONS PGTARGETSESSIONATTRS"

pg_use_connection_uri() {
  local uri="$1"
  local label="${2:-DATABASE_URL}"
  local lib_dir parsed status var

  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  if ! command -v node >/dev/null 2>&1; then
    printf 'ERROR: node not found on PATH. %s is parsed by node so the password never reaches argv; install Node >= 20.12 (the repo engines floor) or run this through "npm run".\n' \
      "$label" >&2
    return 1
  fi

  # The URI travels to the child in its environment, never in argv.
  # Command substitution keeps the parsed output in a shell variable of
  # this process, which is not in the process table either.
  status=0
  parsed="$(OPENRD_PG_URI="$uri" OPENRD_PG_LABEL="$label" node "$lib_dir/pg-uri-env.mjs")" || status=$?
  if [ "$status" -ne 0 ]; then
    return "$status"
  fi

  # Clear anything inherited from the caller's shell first. A leftover
  # PGDATABASE from a previous psql session would otherwise survive into
  # a URI that legitimately omits that field and silently point the dump
  # at the wrong database.
  # shellcheck disable=SC2086 # deliberate word splitting of the list
  unset $OPENRD_PG_VARS OPENRD_PG_DESC

  eval "$parsed"

  for var in $OPENRD_PG_VARS; do
    if [ -n "${!var:-}" ]; then
      export "${var?}"
    fi
  done

  PG_DESC="${OPENRD_PG_DESC:-${PGDATABASE:-unknown}}"
  return 0
}
