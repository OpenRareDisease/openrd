import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { resolvePgSsl } from './pool.js';
import { loadAppEnv } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The only thing the runner needs from a connection. Narrowing to this
 * is what lets the rollback path — the one that issues a DELETE against
 * `schema_migrations` — be unit-tested against a recording fake instead
 * of a live Postgres. A `pg.Client` does not structurally satisfy it
 * (its `query` is overloaded), so `asLedgerClient` adapts once in
 * `main()`.
 */
export interface MigrationLedgerClient {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

const asLedgerClient = (client: Client): MigrationLedgerClient => ({
  query: async (sql, values) => {
    const result = values === undefined ? await client.query(sql) : await client.query(sql, values);
    return { rows: result.rows as Array<Record<string, unknown>>, rowCount: result.rowCount };
  },
});

const resolvePath = (candidates: string[]) => {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Migration path could not be resolved');
};

const getMigrationsDir = () =>
  resolvePath([
    path.resolve(process.cwd(), '../../db/migrations'),
    path.resolve(process.cwd(), 'db/migrations'),
    path.resolve(__dirname, '../../../../db/migrations'),
  ]);

const getInitDbPath = () =>
  resolvePath([
    path.resolve(process.cwd(), '../../db/init_db.sql'),
    path.resolve(process.cwd(), 'db/init_db.sql'),
    path.resolve(__dirname, '../../../../db/init_db.sql'),
  ]);

const getDatabaseName = (connectionString: string) => {
  const parsed = new URL(connectionString);
  return parsed.pathname.replace(/^\//, '') || 'postgres';
};

const withDatabaseName = (connectionString: string, databaseName: string) => {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const normalizeSqlText = (value: string) => value.replace(/^\uFEFF/, '');

const readSqlFile = async (filePath: string) => {
  const raw = await fs.readFile(filePath);
  const isUtf16Le = raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe;
  const isUtf16Be = raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff;

  if (isUtf16Le) {
    return normalizeSqlText(raw.toString('utf16le'));
  }

  if (isUtf16Be) {
    const swapped = Buffer.from(raw);
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const current = swapped[index];
      swapped[index] = swapped[index + 1];
      swapped[index + 1] = current;
    }
    return normalizeSqlText(swapped.toString('utf16le'));
  }

  return normalizeSqlText(raw.toString('utf8'));
};

/** SQLSTATE 3D000 — invalid_catalog_name, i.e. "database does not exist". */
const INVALID_CATALOG_NAME = '3D000';

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;

/**
 * Create the application database if it is missing — but only after
 * establishing that it really is missing.
 *
 * This used to open a connection to the `postgres` maintenance database
 * unconditionally, before ever trying the target. That is harmless on
 * the compose stack, where the api connects as the `postgres`
 * superuser and the maintenance DB is one hop away on the same bridge.
 * It stops being harmless the first time DATABASE_URL points at a
 * managed provider (.env.example and env.ts both anticipate RDS /
 * Cloud SQL): those hand out an application role that frequently
 * cannot connect to `postgres` at all and never has CREATE DATABASE.
 * Because migrations are the first half of the container CMD
 * (apps/api/Dockerfile), the api would then crash-loop on an error
 * naming the *maintenance* database — pointing the operator at the one
 * database that has nothing to do with the deploy.
 *
 * So: probe the target first. A successful connect means there is
 * nothing to create and the admin path is never taken. Only SQLSTATE
 * 3D000 (invalid_catalog_name) proves the database is absent; every
 * other failure — bad password, no route, TLS refused — is rethrown as
 * is, because those are the operator's actual problem and the admin
 * connection would fail on them too, with a more confusing message.
 */
const ensureDatabaseExists = async (
  connectionString: string,
  ssl: ReturnType<typeof resolvePgSsl>,
) => {
  const targetDatabase = getDatabaseName(connectionString);

  const probeClient = new Client({ connectionString, ssl });
  try {
    await probeClient.connect();
    await probeClient.end();
    return;
  } catch (error) {
    // `connect()` failed, so there is no session to close; end() would
    // itself reject. Swallow that separately from the decision below.
    await probeClient.end().catch(() => undefined);
    if (errorCodeOf(error) !== INVALID_CATALOG_NAME) {
      throw error;
    }
  }

  const adminClient = new Client({
    connectionString: withDatabaseName(connectionString, 'postgres'),
    ssl,
  });

  await adminClient.connect();
  try {
    const existing = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      targetDatabase,
    ]);
    if (!existing.rowCount) {
      await adminClient.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)}`);
      process.stdout.write(`Created database ${targetDatabase}\n`);
    }
  } finally {
    await adminClient.end();
  }
};

const extractBootstrapSql = (initDbSql: string, databaseName: string) => {
  const lines = initDbSql.split(/\r?\n/);
  const connectIndexes = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((item) => item.line.startsWith('\\connect '));
  const secondConnect = connectIndexes[1]?.index ?? -1;
  const sql = secondConnect >= 0 ? lines.slice(secondConnect + 1).join('\n') : initDbSql;
  return sql.replace(/fshd_openrd/g, databaseName);
};

/**
 * SHA-256 of the exact text handed to Postgres, so `--status` can tell
 *「applied」 apart from 「applied, but the file on disk is no longer what
 * ran」. The ledger keys on filename alone; without this, editing an
 * already-applied migration is undetectable, and the two environments
 * silently diverge — prod carrying the old statements, a fresh clone
 * carrying the new ones, both reporting `applied`.
 *
 * This is a report, not a gate: a drifted checksum must not stop a
 * deploy, because the common cause is a benign comment edit and the
 * runner has no way to tell that from a semantic one.
 */
const checksumOf = (sql: string) => createHash('sha256').update(sql, 'utf8').digest('hex');

const ensureMigrationsTable = async (client: MigrationLedgerClient) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Separate ALTER rather than a third column in the CREATE above:
  // every existing deployment already has this table, and
  // `CREATE TABLE IF NOT EXISTS` does not reconcile columns — it just
  // does nothing. Rows recorded before this shipped keep a NULL
  // checksum and are reported as `applied` with no drift verdict,
  // which is the honest answer: we have no baseline for them.
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
};

/** id → recorded checksum (null for rows written before checksums, and
 *  for the bootstrap pseudo-entry, which has no single source file). */
const getAppliedMigrations = async (client: MigrationLedgerClient) => {
  const result = await client.query('SELECT id, checksum FROM schema_migrations');
  return new Map<string, string | null>(
    result.rows.map((row) => [String(row.id), row.checksum == null ? null : String(row.checksum)]),
  );
};

/**
 * Serialises the whole runner against itself.
 *
 * `apps/api/Dockerfile` makes `node dist/db/migrate.js` the first half
 * of the container CMD, so every api container migrates on every start.
 * docker-compose.yml declares a single `api:` service with no
 * `deploy.replicas`, so today only one process can be in here — but the
 * moment someone scales to two replicas, or runs `npm run db:migrate`
 * by hand while a container is booting, two runners read the same
 * `applied` set, both decide the same file is pending, and both run it.
 * Postgres has no `CREATE TABLE IF NOT EXISTS`-equivalent for
 * `ADD CONSTRAINT`, so the loser dies on 42710 (or 42P07 against 003's
 * plain CREATE TABLE) and crash-loops before it ever reaches
 * `node dist/index.js`.
 *
 * With the lock the second runner blocks, wakes up, re-reads the ledger
 * and finds nothing pending — which is the behaviour an operator
 * already assumes they have.
 *
 * The key is arbitrary and must never change; it is only ever compared
 * against itself. It is spelled out as a literal rather than hashed at
 * runtime so that a `SELECT objid FROM pg_locks WHERE locktype =
 * 'advisory'` on a wedged deploy has something greppable in the tree.
 */
const MIGRATION_ADVISORY_LOCK_KEY = 4726318951;

const withMigrationLock = async <T>(
  client: MigrationLedgerClient,
  run: () => Promise<T>,
): Promise<T> => {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
  try {
    return await run();
  } finally {
    // Session-level lock on the one client this process owns, so an
    // unlock failure here cannot strand it: `client.end()` in main()'s
    // finally block drops the session and Postgres releases it.
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
  }
};

const hasExistingCoreSchema = async (client: MigrationLedgerClient) => {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      ) AS exists
    `,
    [['app_users', 'auth_otps', 'patient_profiles', 'patient_documents']],
  );
  return result.rows[0]?.exists === true;
};

const applyBootstrapIfNeeded = async (client: MigrationLedgerClient, databaseName: string) => {
  const bootstrapId = '000_init_db_bootstrap';
  const applied = await getAppliedMigrations(client);
  if (applied.has(bootstrapId)) {
    return;
  }

  if (await hasExistingCoreSchema(client)) {
    await client.query(
      'INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [bootstrapId],
    );
    process.stdout.write(`Marked ${bootstrapId} as applied (existing schema detected)\n`);
    return;
  }

  const initDbSql = await readSqlFile(getInitDbPath());
  const bootstrapSql = extractBootstrapSql(initDbSql, databaseName);

  await client.query('BEGIN');
  try {
    await client.query(bootstrapSql);
    await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [bootstrapId]);
    await client.query('COMMIT');
    process.stdout.write(`Applied ${bootstrapId}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

/**
 * Convention: `db/migrations/NNN_*.sql` files are forward migrations
 * applied in lexicographic order. Sibling `NNN_*_down.sql` files are
 * rollback scripts kept next to their forward counterpart for
 * discoverability — they are operator tools (run by hand via
 * `psql -f` during a hot rollback), NOT part of the forward chain.
 *
 * This filter is the entire mechanism that keeps `_down` scripts out
 * of the forward chain. Before it existed, every `*_down.sql` slotted
 * into the lexicographic order right after its `*.sql` sibling and
 * ran in the same `applyPendingMigrations` loop — so 011 forward
 * would create the CHECK constraints + trigger, and 011_down would
 * immediately drop them again on the same boot, leaving the table
 * with zero CHECK / trigger coverage. 012 had the same shape. The
 * net effect was silent: migrations appeared "applied" in the ledger
 * but the schema carried none of the v2.4.0 data-hygiene work the
 * audit had signed off on.
 *
 * If you add a new rollback script, keep the `_down.sql` suffix and
 * this filter will continue to skip it. If you genuinely need a
 * forward migration to run after a NNN forward, name it NNN+1.
 */
/**
 * Pure predicate so the filter rule is unit-testable without standing
 * up a temp directory. Underscore-prefixed export is the test-only
 * shape used elsewhere in the codebase (e.g. `_scrubErrorDetail`).
 */
export const _isForwardMigrationFile = (filename: string): boolean =>
  filename.endsWith('.sql') && !filename.endsWith('_down.sql');

/**
 * A migration must not manage its own transaction.
 *
 * The runner already wraps each file in BEGIN/COMMIT together with the
 * `schema_migrations` INSERT, and that pairing is the whole point: a
 * file either applies AND is recorded, or neither. A file carrying its
 * own COMMIT splits them. If the ledger INSERT then fails — a pool
 * blip, a reset connection — the schema change is live but unrecorded,
 * so the next deploy re-runs the file. Postgres has no
 * `ADD CONSTRAINT IF NOT EXISTS`, so it raises 42710, the runner
 * throws, and **every migration numbered above it never applies**.
 * Recovery is hand-editing `schema_migrations` on the production box.
 *
 * Four files had done this (011, 012, 015, 017) — the ones doing
 * irreversible DDL, i.e. exactly the ones the guarantee was for. 015
 * additionally re-runs a destructive `UPDATE … SET unit = NULL` on its
 * way to failing.
 *
 * Matches only a statement-leading keyword, so the words inside a
 * comment or a string literal do not trip it.
 */
const SELF_MANAGED_TX = /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\s*;/im;

/** Comments only. These files are heavily commented — 015's header
 *  explains at length why it does NOT follow 012's NOT VALID
 *  convention — and a `-- … COMMIT …` in prose must not trip the
 *  guard. */
const stripSqlComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

export const _hasSelfManagedTransaction = (sql: string): boolean =>
  SELF_MANAGED_TX.test(stripSqlComments(sql));

const listMigrationFiles = async () => {
  const migrationsDir = getMigrationsDir();
  const entries = await fs.readdir(migrationsDir);
  return entries.filter(_isForwardMigrationFile).sort();
};

const assertRunnerOwnsTransaction = (file: string, sql: string) => {
  if (_hasSelfManagedTransaction(sql)) {
    throw new Error(
      `${file} contains its own BEGIN/COMMIT/ROLLBACK. The runner wraps each ` +
        `migration in a transaction together with its schema_migrations row; a ` +
        `file managing its own splits that pairing and can leave the schema ` +
        `applied but unrecorded. Remove the transaction control from the file.`,
    );
  }
};

const applyPendingMigrations = async (client: MigrationLedgerClient) => {
  const applied = await getAppliedMigrations(client);
  const files = await listMigrationFiles();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await readSqlFile(path.join(getMigrationsDir(), file));
    assertRunnerOwnsTransaction(file, sql);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [
        file,
        checksumOf(sql),
      ]);
      await client.query('COMMIT');
      process.stdout.write(`Applied ${file}\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
};

/**
 * `NNN_name.sql` → `NNN_name_down.sql`. The naming convention is load
 * bearing in both directions: `_isForwardMigrationFile` uses the suffix
 * to keep rollback scripts out of the forward chain, and this uses it
 * to find the rollback script for a forward file.
 */
export const _downFilenameFor = (forwardFile: string): string =>
  `${forwardFile.replace(/\.sql$/, '')}_down.sql`;

/**
 * Accepts what an operator under deploy pressure will actually type:
 * `015`, `015_function_test_unit_constraint`,
 * `015_function_test_unit_constraint.sql`, or the `_down.sql` name
 * itself. Returns the FORWARD filename, because that — not the down
 * file — is the `schema_migrations.id` that has to come out.
 *
 * Refuses anything ambiguous rather than guessing. Rolling back the
 * wrong migration on a production PHI database is not a mistake worth
 * being lenient about.
 */
export const _resolveDownTarget = (arg: string, forwardFiles: string[]): string => {
  const needle = arg
    .trim()
    .replace(/\.sql$/, '')
    .replace(/_down$/, '');
  if (!needle) {
    throw new Error('--down requires a migration id, e.g. `--down 015`');
  }

  const matches = forwardFiles.filter((file) => {
    const base = file.replace(/\.sql$/, '');
    return base === needle || base.split('_')[0] === needle;
  });

  if (matches.length === 0) {
    throw new Error(
      `No forward migration matches "${arg}". Known migrations: ${forwardFiles.join(', ')}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(`"${arg}" is ambiguous — it matches ${matches.join(', ')}. Give a full name.`);
  }
  return matches[0];
};

/**
 * Roll one migration back: run its `_down.sql` AND delete its
 * `schema_migrations` row, in a single transaction.
 *
 * Both halves, atomically, is the entire point. The documented manual
 * procedure (`psql $PROD_DB < db/migrations/NNN_..._down.sql`) does only
 * the first half, which leaves the ledger asserting the migration is
 * applied while the schema no longer carries it. The next deploy then
 * reads that row, skips the file, prints nothing and exits 0 — so the
 * constraint or trigger the rollback removed never comes back, and the
 * deploy reports success. That is the same silent class of failure the
 * `_down.sql` filter was added to fix, reachable through the repo's own
 * rollback instructions.
 *
 * Refuses when the ledger has no row for the migration, because that
 * means either the rollback already ran or the migration never applied,
 * and blindly re-running a down script is how a partially-migrated
 * database gets further mangled. `--force` exists for the one case
 * where refusing is wrong: the operator already ran the down file by
 * hand under the old procedure and needs the ledger row gone.
 */
export const _rollBackMigration = async (
  client: MigrationLedgerClient,
  forwardFile: string,
  force: boolean,
) => {
  const downFile = _downFilenameFor(forwardFile);
  const downPath = path.join(getMigrationsDir(), downFile);

  if (!existsSync(downPath)) {
    throw new Error(
      `${forwardFile} has no rollback script (${downFile} does not exist). ` +
        `Write one next to the forward migration before rolling back.`,
    );
  }

  const applied = await getAppliedMigrations(client);
  if (!applied.has(forwardFile) && !force) {
    throw new Error(
      `${forwardFile} is not recorded in schema_migrations, so there is nothing to ` +
        `roll back. If you already ran ${downFile} by hand and only need the ledger ` +
        `row removed, re-run with --force.`,
    );
  }

  const sql = await readSqlFile(downPath);
  assertRunnerOwnsTransaction(downFile, sql);

  await client.query('BEGIN');
  try {
    await client.query(sql);
    const result = await client.query('DELETE FROM schema_migrations WHERE id = $1', [forwardFile]);
    await client.query('COMMIT');
    process.stdout.write(
      `Rolled back ${forwardFile}: applied ${downFile} and removed ${result.rowCount ?? 0} ledger row(s)\n`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

const printStatus = async (client: MigrationLedgerClient) => {
  const applied = await getAppliedMigrations(client);
  const files = await listMigrationFiles();

  const bootstrapId = '000_init_db_bootstrap';
  process.stdout.write(
    `${(applied.has(bootstrapId) ? 'applied' : 'pending').padEnd(8)} ${bootstrapId}\n`,
  );

  for (const file of files) {
    if (!applied.has(file)) {
      process.stdout.write(`${'pending'.padEnd(8)} ${file}\n`);
      continue;
    }
    const recorded = applied.get(file) ?? null;
    if (recorded === null) {
      // Applied before checksums existed. No baseline, so no verdict.
      process.stdout.write(`${'applied'.padEnd(8)} ${file}\n`);
      continue;
    }
    const onDisk = checksumOf(await readSqlFile(path.join(getMigrationsDir(), file)));
    if (onDisk === recorded) {
      process.stdout.write(`${'applied'.padEnd(8)} ${file}\n`);
    } else {
      process.stdout.write(
        `${'drifted'.padEnd(8)} ${file}  (file on disk differs from what was applied here)\n`,
      );
    }
  }
};

const USAGE = [
  'Usage:',
  '  migrate                 apply every pending migration',
  '  migrate --status        list applied / pending / drifted',
  '  migrate --down <id>     run <id>_down.sql and delete its ledger row',
  '  migrate --down <id> --force   delete the ledger row even if absent',
].join('\n');

const main = async () => {
  const env = loadAppEnv();
  const databaseName = getDatabaseName(env.DATABASE_URL);
  const argv = process.argv.slice(2);
  const downIndex = argv.indexOf('--down');
  const mode = downIndex >= 0 ? 'down' : argv.includes('--status') ? 'status' : 'apply';
  const downArg = downIndex >= 0 ? argv[downIndex + 1] : undefined;

  if (mode === 'down' && (!downArg || downArg.startsWith('--'))) {
    throw new Error(`--down requires a migration id.\n${USAGE}`);
  }

  await ensureDatabaseExists(env.DATABASE_URL, resolvePgSsl(env));

  const pgClient = new Client({
    connectionString: env.DATABASE_URL,
    ssl: resolvePgSsl(env),
  });

  await pgClient.connect();
  const client = asLedgerClient(pgClient);
  try {
    await ensureMigrationsTable(client);

    // Every mode runs under the lock, including --status: a status
    // read taken while another container is halfway through the loop
    // reports a state that was never true at any instant.
    await withMigrationLock(client, async () => {
      if (mode === 'down') {
        // No bootstrap here on purpose. Rolling back presupposes a
        // migrated database; running init_db.sql on the way to a
        // rollback would be the opposite of what the operator asked
        // for. An unbootstrapped database has no ledger row to remove
        // and _rollBackMigration refuses on exactly that.
        const forwardFile = _resolveDownTarget(downArg as string, await listMigrationFiles());
        await _rollBackMigration(client, forwardFile, argv.includes('--force'));
        return;
      }

      await applyBootstrapIfNeeded(client, databaseName);

      if (mode === 'status') {
        await printStatus(client);
        return;
      }

      await applyPendingMigrations(client);
      process.stdout.write('Database migrations completed\n');
    });
  } finally {
    await pgClient.end();
  }
};

/**
 * Only migrate when this file IS the program.
 *
 * `main()` used to run at module scope, so merely importing this module
 * connected to DATABASE_URL and applied every pending migration.
 * migrate.test.ts imports it for the exported predicates, which meant a
 * plain `npx vitest run` on a developer machine with a live .env would
 * migrate that developer's database as a side effect of running the
 * test suite — and, now that `--down` exists, would do so with whatever
 * happened to be sitting in `process.argv`.
 *
 * Compared against the resolved entry path rather than an env-var
 * sniff so it holds for every way this is actually launched:
 * `node dist/db/migrate.js` (the container CMD in apps/api/Dockerfile),
 * `tsx src/db/migrate.ts` (the api workspace's npm scripts), and
 * `node node_modules/.bin/tsx apps/api/src/db/migrate.ts` (the
 * repo-root db:migrate:down script). All three are exercised by hand
 * before this lands, because the failure mode of getting it wrong is a
 * deploy that silently skips migrations.
 */
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return path.resolve(entry) === fileURLToPath(import.meta.url);
})();

if (invokedDirectly) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
