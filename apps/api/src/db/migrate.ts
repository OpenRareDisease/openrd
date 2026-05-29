import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { loadAppEnv } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const ensureDatabaseExists = async (connectionString: string) => {
  const targetDatabase = getDatabaseName(connectionString);
  const adminClient = new Client({
    connectionString: withDatabaseName(connectionString, 'postgres'),
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

const ensureMigrationsTable = async (client: Client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const getAppliedMigrations = async (client: Client) => {
  const result = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
  return new Set(result.rows.map((row) => row.id));
};

const hasExistingCoreSchema = async (client: Client) => {
  const result = await client.query<{ exists: boolean }>(
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
  return result.rows[0]?.exists ?? false;
};

const applyBootstrapIfNeeded = async (client: Client, databaseName: string) => {
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

const listMigrationFiles = async () => {
  const migrationsDir = getMigrationsDir();
  const entries = await fs.readdir(migrationsDir);
  return entries.filter(_isForwardMigrationFile).sort();
};

const applyPendingMigrations = async (client: Client) => {
  const applied = await getAppliedMigrations(client);
  const files = await listMigrationFiles();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await readSqlFile(path.join(getMigrationsDir(), file));
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      process.stdout.write(`Applied ${file}\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
};

const printStatus = async (client: Client) => {
  const applied = await getAppliedMigrations(client);
  const files = ['000_init_db_bootstrap', ...(await listMigrationFiles())];
  files.forEach((file) => {
    const status = applied.has(file) ? 'applied' : 'pending';
    process.stdout.write(`${status.padEnd(8)} ${file}\n`);
  });
};

const main = async () => {
  const env = loadAppEnv();
  const databaseName = getDatabaseName(env.DATABASE_URL);
  const mode = process.argv.includes('--status') ? 'status' : 'apply';

  await ensureDatabaseExists(env.DATABASE_URL);

  const client = new Client({
    connectionString: env.DATABASE_URL,
    ssl:
      env.DATABASE_SSL_ENABLED || env.isProductionLike
        ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED }
        : undefined,
  });

  await client.connect();
  try {
    await ensureMigrationsTable(client);
    await applyBootstrapIfNeeded(client, databaseName);

    if (mode === 'status') {
      await printStatus(client);
      return;
    }

    await applyPendingMigrations(client);
    process.stdout.write('Database migrations completed\n');
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
