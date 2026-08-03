#!/usr/bin/env node
//
// Turn a Postgres connection URI into libpq environment assignments.
//
// Reads the URI from OPENRD_PG_URI (the *environment*, never argv) and
// writes shell-quoted `PGHOST='…'` lines to stdout for the caller to
// `eval`. That is the whole point of this file:
//
//   * `psql "$DATABASE_URL"` and `pg_dump … "$DATABASE_URL"` put the
//     password in the process table. /proc/<pid>/cmdline is world
//     readable on a stock Linux host, so any unprivileged local account
//     can read the production database password with `ps auxww` for the
//     whole duration of a dump — minutes, for a database carrying the
//     1024-dim kb_chunks embeddings. The environment block
//     (/proc/<pid>/environ) is readable only by the process owner and
//     root, which is the protection argv does not have.
//   * The previous DB_NAME extraction (`sed -E 's#^.*/([^/?]+)…#\1#'`)
//     left non-matching input unchanged, so a DATABASE_URL with no path
//     component — `postgres://u:pw@h:5432`, which libpq accepts by
//     defaulting the database to the user name — yielded the literal
//     string `u:pw@h:5432`. That went into the dump FILENAME and into
//     the log line the crontab example appends to
//     /var/log/openrd-backup.log. Parsing here instead means a path-less
//     URI is a loud failure rather than a password written to disk.
//
// Exit codes: 2 unusable/missing URI, 3 wrong scheme, 4 no database name.

const raw = process.env.OPENRD_PG_URI ?? '';
const label = process.env.OPENRD_PG_LABEL || 'DATABASE_URL';

const die = (code, message) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

if (!raw) {
  die(2, `ERROR: ${label} is empty.`);
}

let url;
try {
  url = new URL(raw);
} catch {
  // Deliberately does NOT echo the value back: a malformed URI is still
  // a URI with a password in it, and this stderr goes to the same
  // append-only cron log as everything else.
  die(2, `ERROR: ${label} is not a parseable connection URI (value withheld — it carries a password).`);
}

if (!/^postgres(ql)?:$/.test(url.protocol)) {
  die(3, `ERROR: ${label} must be a postgres:// or postgresql:// URI, got scheme "${url.protocol}".`);
}

const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
if (!database) {
  die(
    4,
    `ERROR: ${label} has no database name (nothing after the host, e.g. ".../openrd"). ` +
      `libpq would silently connect to a database named after the connecting role instead, so the ` +
      `command would appear to work against the wrong database. Add the database to the URI.`,
  );
}

// Single quotes with the POSIX '\'' escape: safe for every byte a
// password can contain, including $ ` " \ and newlines.
const shellQuote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

const emit = (name, value) => {
  if (value === undefined || value === null || value === '') return;
  process.stdout.write(`${name}=${shellQuote(value)}\n`);
};

emit('PGDATABASE', database);
// url.hostname strips the brackets from an IPv6 literal, which is
// exactly the form PGHOST wants. An empty host means a unix socket by
// libpq's own default, so leave PGHOST unset rather than forcing ''.
emit('PGHOST', decodeURIComponent(url.hostname));
emit('PGPORT', url.port);
emit('PGUSER', decodeURIComponent(url.username));
// Omitted entirely when the URI carries no password, so libpq still
// falls back to ~/.pgpass or peer auth. Exporting PGPASSWORD='' would
// instead assert "the password is the empty string" and break both.
if (url.password) {
  emit('PGPASSWORD', decodeURIComponent(url.password));
}

// Query parameters that change whether the connection works at all.
// Dropping sslmode=require on the way to PG* variables would silently
// downgrade a managed-provider connection from TLS-required to
// TLS-preferred, so every parameter is either translated or reported.
const PARAM_TO_ENV = new Map([
  ['sslmode', 'PGSSLMODE'],
  ['sslrootcert', 'PGSSLROOTCERT'],
  ['sslcert', 'PGSSLCERT'],
  ['sslkey', 'PGSSLKEY'],
  ['connect_timeout', 'PGCONNECT_TIMEOUT'],
  ['application_name', 'PGAPPNAME'],
  ['options', 'PGOPTIONS'],
  ['target_session_attrs', 'PGTARGETSESSIONATTRS'],
]);

const unsupported = [];
for (const [key, value] of url.searchParams) {
  const envName = PARAM_TO_ENV.get(key);
  if (envName) {
    emit(envName, value);
  } else {
    unsupported.push(key);
  }
}

if (unsupported.length > 0) {
  process.stderr.write(
    `WARNING: ${label} carries connection parameter(s) this script does not translate: ` +
      `${unsupported.join(', ')}. They are NOT in effect for psql/pg_dump/pg_restore. ` +
      `Add them to PARAM_TO_ENV in scripts/lib/pg-uri-env.mjs if they matter.\n`,
  );
}

// Credential-free description for logs, incident channels and error
// messages. Everything printed by the calling scripts uses this.
const userPart = url.username ? `${decodeURIComponent(url.username)}@` : '';
const hostPart = url.hostname ? decodeURIComponent(url.hostname) : 'local socket';
const portPart = url.port ? `:${url.port}` : '';
emit('OPENRD_PG_DESC', `${userPart}${hostPart}${portPart}/${database}`);
