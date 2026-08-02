import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  _downFilenameFor,
  _hasSelfManagedTransaction,
  _isForwardMigrationFile,
  _resolveDownTarget,
  _rollBackMigration,
  type MigrationLedgerClient,
} from './migrate.js';

/**
 * Records every statement the runner issues so the rollback's
 * transaction shape can be asserted without a live Postgres. Only the
 * ledger SELECT needs a canned answer; everything else is fire and
 * forget from the runner's point of view.
 */
const recordingClient = (ledgerRows: Array<{ id: string; checksum: string | null }>) => {
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  const client: MigrationLedgerClient = {
    query: async (sql, values) => {
      statements.push({ sql, values });
      if (sql.includes('FROM schema_migrations')) {
        return { rows: ledgerRows, rowCount: ledgerRows.length };
      }
      return { rows: [], rowCount: sql.startsWith('DELETE') ? 1 : 0 };
    },
  };
  return { client, statements };
};

/*
 * Regression: before this filter existed, the migration runner
 * applied every `*.sql` in `db/migrations/`, including the
 * `*_down.sql` rollback scripts that live next to their forward
 * counterpart. Lexicographic order put each `NNN_*_down.sql` right
 * after its `NNN_*.sql` sibling, so the runner would:
 *
 *   1. apply 011_status_check_constraints.sql (creates CHECK
 *      constraints + patient_followup_events_same_profile trigger)
 *   2. apply 011_status_check_constraints_down.sql (DROPs every
 *      constraint + the trigger 011 just created — silent)
 *   3. apply 012_text_column_constraints.sql (creates 3 more CHECK)
 *   4. apply 012_text_column_constraints_down.sql (DROPs those too)
 *
 * Net result: prod boots, migrations "succeed", the ledger shows
 * 011/012 + their `_down` siblings applied, but the schema carries
 * none of the v2.4.0 data-hygiene guards. We only noticed locally
 * because step 3 of the pre-deploy validation queried
 * pg_constraint and got zero CHECK rows on patient_documents.
 *
 * These tests pin the contract: the runner MUST skip files whose
 * name ends in `_down.sql`, and MUST keep every forward-shaped
 * `*.sql`.
 */
describe('migrate — _isForwardMigrationFile filter (P0 regression)', () => {
  it('accepts forward migrations regardless of numeric prefix', () => {
    expect(_isForwardMigrationFile('000_init_db_bootstrap')).toBe(false);
    // The bootstrap entry doesn't end in `.sql` in the ledger, but a
    // real file would. The forward chain is `.sql`-suffixed.
    expect(_isForwardMigrationFile('003_complete_chat_system.sql')).toBe(true);
    expect(_isForwardMigrationFile('011_status_check_constraints.sql')).toBe(true);
    expect(_isForwardMigrationFile('012_text_column_constraints.sql')).toBe(true);
    expect(_isForwardMigrationFile('999_future_migration.sql')).toBe(true);
  });

  it('rejects rollback scripts (the P0 case)', () => {
    expect(_isForwardMigrationFile('011_status_check_constraints_down.sql')).toBe(false);
    expect(_isForwardMigrationFile('012_text_column_constraints_down.sql')).toBe(false);
    // A future _down for a hypothetical 013 must also be skipped.
    expect(_isForwardMigrationFile('013_hypothetical_down.sql')).toBe(false);
  });

  it('rejects non-sql siblings (README, schema dumps, etc.)', () => {
    expect(_isForwardMigrationFile('README.md')).toBe(false);
    expect(_isForwardMigrationFile('011_status_check_constraints.sql.bak')).toBe(false);
    expect(_isForwardMigrationFile('.DS_Store')).toBe(false);
  });

  it('treats `_down` only as a suffix, not anywhere in the name', () => {
    // A file legitimately named e.g. `015_count_down_timer.sql` is
    // forward and must NOT be skipped just because it contains the
    // substring `_down`.
    expect(_isForwardMigrationFile('015_count_down_timer.sql')).toBe(true);
    expect(_isForwardMigrationFile('016_breakdown_table.sql')).toBe(true);
  });
});

describe('_hasSelfManagedTransaction', () => {
  // Four migrations used to carry their own BEGIN/COMMIT, which split
  // the schema change from its schema_migrations INSERT. A failure
  // between the two leaves the change applied but unrecorded, and the
  // next deploy re-runs the file — where ADD CONSTRAINT has no
  // IF NOT EXISTS, so it raises 42710 and wedges every later migration.
  it('flags a file that manages its own transaction', () => {
    expect(_hasSelfManagedTransaction('BEGIN;\nALTER TABLE t ADD COLUMN y INT;\nCOMMIT;')).toBe(
      true,
    );
  });

  it('accepts a file that leaves the transaction to the runner', () => {
    expect(_hasSelfManagedTransaction('ALTER TABLE t ADD CONSTRAINT c CHECK (x IS NULL);')).toBe(
      false,
    );
  });

  // These files are heavily commented — 015's header explains at length
  // why it does not follow 012's NOT VALID convention — so prose that
  // mentions the keywords must not trip the guard.
  it.each([
    ['a line comment', '-- explains why this does not COMMIT on its own\nUPDATE t SET x = 1;'],
    ['a block comment', '/* BEGIN; would be wrong here */\nUPDATE t SET x = 1;'],
    ['a string literal', "INSERT INTO logs (msg) VALUES ('COMMIT; happened');"],
  ])('does not trip on %s', (_label, sql) => {
    expect(_hasSelfManagedTransaction(sql)).toBe(false);
  });

  it('catches START TRANSACTION too', () => {
    expect(_hasSelfManagedTransaction('START TRANSACTION;\nUPDATE t SET x = 1;')).toBe(true);
  });
});

/**
 * The predicate above was, for one commit, exercised only by its own
 * unit tests — it was exported, documented as a guard, and never
 * called by applyPendingMigrations. A rule nothing enforces is not a
 * rule, so this runs it over the real corpus.
 *
 * Reading the files off disk rather than asserting on runner internals
 * is deliberate: this is the check that fires when someone adds
 * migration 019 with a BEGIN in it, which is the only time it matters.
 * `_down.sql` files are included even though the forward runner never
 * sees them — they are applied by hand against the same runner
 * conventions, and 011/012/015/017's down twins had the same problem.
 */
describe('every migration on disk leaves the transaction to the runner', () => {
  const migrationsDir = path.resolve(__dirname, '../../../../db/migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

  it('finds the migrations directory', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s', (file) => {
    // Matches readSqlFile: 003_complete_chat_system.sql is UTF-16, and
    // reading it as UTF-8 would yield NUL-interleaved text the regex
    // silently fails to match — a false pass, the worst kind.
    const raw = fs.readFileSync(path.join(migrationsDir, file));
    const sql = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
    expect(_hasSelfManagedTransaction(sql)).toBe(false);
  });
});

/*
 * The rollback path.
 *
 * Before `--down` existed, the documented hot-rollback procedure was
 * `psql $PROD_DB < db/migrations/NNN_..._down.sql` — which reverses the
 * schema and leaves the `schema_migrations` row in place. The ledger
 * then claims the migration is applied while the schema no longer
 * carries it, so the roll-forward that follows skips the file, prints
 * nothing and exits 0. The constraint stays gone and the deploy reports
 * success.
 *
 * These pin the two halves that make that impossible: the target
 * resolution (never guess which migration to reverse) and the file
 * naming that connects a forward migration to its rollback script.
 */
describe('migrate — rollback target resolution', () => {
  const forwardFiles = [
    '003_complete_chat_system.sql',
    '011_status_check_constraints.sql',
    '015_function_test_unit_constraint.sql',
    '018_measurement_cohort_index.sql',
  ];

  it('derives the _down filename from the forward one', () => {
    expect(_downFilenameFor('015_function_test_unit_constraint.sql')).toBe(
      '015_function_test_unit_constraint_down.sql',
    );
  });

  it.each([
    ['a bare number', '015'],
    ['the stem', '015_function_test_unit_constraint'],
    ['the full forward filename', '015_function_test_unit_constraint.sql'],
    // An operator reading §4.1 of the runbook has the _down name in
    // front of them; typing that must not be a silent miss.
    ['the _down filename', '015_function_test_unit_constraint_down.sql'],
  ])('resolves %s to the forward migration', (_label, arg) => {
    expect(_resolveDownTarget(arg, forwardFiles)).toBe('015_function_test_unit_constraint.sql');
  });

  it('tolerates surrounding whitespace from a copy-paste', () => {
    expect(_resolveDownTarget('  018  ', forwardFiles)).toBe('018_measurement_cohort_index.sql');
  });

  it('refuses an id that matches nothing, and names what it knows', () => {
    expect(() => _resolveDownTarget('019', forwardFiles)).toThrow(/No forward migration matches/);
    expect(() => _resolveDownTarget('019', forwardFiles)).toThrow(
      /015_function_test_unit_constraint\.sql/,
    );
  });

  it('refuses an ambiguous id rather than guessing', () => {
    // Two files could legitimately share a numeric prefix during a
    // rebase or a badly-resolved merge. Rolling back the wrong one on a
    // production PHI database is not a coin worth flipping.
    const ambiguous = ['015_first.sql', '015_second.sql'];
    expect(() => _resolveDownTarget('015', ambiguous)).toThrow(/ambiguous/);
    expect(() => _resolveDownTarget('015', ambiguous)).toThrow(/015_first\.sql, 015_second\.sql/);
  });

  it('refuses an empty id', () => {
    expect(() => _resolveDownTarget('   ', forwardFiles)).toThrow(/requires a migration id/);
  });
});

/*
 * Rollback scripts run through the same runner-owned transaction as
 * forward migrations, because the DELETE against `schema_migrations`
 * has to commit with the schema change or not at all. So they are held
 * to the same no-self-managed-transaction rule, and 015's down script
 * in particular contains a plpgsql DO block whose `BEGIN` must not be
 * mistaken for transaction control.
 */
describe('every _down script on disk has a forward sibling and no transaction control', () => {
  const migrationsDir = path.resolve(__dirname, '../../../../db/migrations');
  const downFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('_down.sql'));

  it('finds rollback scripts', () => {
    expect(downFiles.length).toBeGreaterThan(0);
  });

  it.each(downFiles)('%s has the forward migration it claims to reverse', (file) => {
    const forward = file.replace(/_down\.sql$/, '.sql');
    expect(_downFilenameFor(forward)).toBe(file);
    expect(fs.existsSync(path.join(migrationsDir, forward))).toBe(true);
  });

  it("015's down script restores unit from unit_legacy rather than only dropping the CHECK", () => {
    // The regression this pins: for one release 015 NULLed every
    // unrecognised patient-entered unit and its _down.sql said it
    // "reverses migration 015" while doing nothing but dropping the
    // constraint. A rollback that reports success while the data stays
    // destroyed is worse than one that fails.
    const sql = fs.readFileSync(
      path.join(migrationsDir, '015_function_test_unit_constraint_down.sql'),
      'utf8',
    );
    expect(sql).toMatch(/SET unit = unit_legacy/);
    // …and says so plainly when the column is not there to restore from.
    expect(sql).toMatch(/RAISE WARNING/);
  });

  it("015's forward migration preserves the originals before it destroys them", () => {
    const sql = fs.readFileSync(
      path.join(migrationsDir, '015_function_test_unit_constraint.sql'),
      'utf8',
    );
    const preserveAt = sql.indexOf('SET unit_legacy = unit');
    const destroyAt = sql.indexOf('SET unit = NULL');
    expect(preserveAt).toBeGreaterThan(-1);
    expect(destroyAt).toBeGreaterThan(-1);
    // Order is the whole point: preserving after the NULLing UPDATE
    // would copy the NULLs.
    expect(preserveAt).toBeLessThan(destroyAt);
  });
});

/*
 * The defect this whole mode exists for (audit finding 66): running a
 * `_down.sql` by hand reverses the schema but leaves the
 * `schema_migrations` row behind. The next roll-forward reads that row,
 * skips the file, prints nothing and exits 0 — so the constraint or
 * trigger the rollback removed never comes back while the deploy
 * reports success. The runner therefore has to do both halves, and has
 * to do them in one transaction.
 */
describe('migrate — _rollBackMigration', () => {
  const applied = [
    { id: '018_measurement_cohort_index.sql', checksum: null },
    { id: '015_function_test_unit_constraint.sql', checksum: null },
  ];

  it('runs the _down file and deletes the ledger row inside one transaction', async () => {
    const { client, statements } = recordingClient(applied);
    await _rollBackMigration(client, '018_measurement_cohort_index.sql', false);

    const sqls = statements.map((s) => s.sql);
    const begin = sqls.indexOf('BEGIN');
    const del = sqls.findIndex((s) => s.startsWith('DELETE FROM schema_migrations'));
    const commit = sqls.indexOf('COMMIT');

    expect(begin).toBeGreaterThan(-1);
    // The rollback SQL itself is the statement between BEGIN and the
    // DELETE — assert on its content rather than its index so the test
    // does not break when the file gains a comment.
    expect(sqls[begin + 1]).toMatch(/DROP INDEX IF EXISTS idx_patient_measurements_cohort/);
    expect(del).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(del);
    expect(sqls).not.toContain('ROLLBACK');

    // The ledger row removed must be the FORWARD filename, since that
    // is what `applied.has(file)` checks on the next roll-forward.
    expect(statements[del].values).toEqual(['018_measurement_cohort_index.sql']);
  });

  it('refuses when the ledger has no row for the migration', async () => {
    const { client, statements } = recordingClient([]);
    await expect(
      _rollBackMigration(client, '018_measurement_cohort_index.sql', false),
    ).rejects.toThrow(/not recorded in schema_migrations/);
    // Nothing may have been executed — a down script run against a
    // database that never had the migration is how a half-migrated
    // schema gets further mangled.
    expect(statements.map((s) => s.sql)).not.toContain('BEGIN');
  });

  it('--force removes a ledger row for a rollback already run by hand', async () => {
    const { client, statements } = recordingClient([]);
    await _rollBackMigration(client, '018_measurement_cohort_index.sql', true);
    expect(statements.map((s) => s.sql)).toContain('COMMIT');
  });

  it('rolls the transaction back when the _down script fails', async () => {
    const statements: string[] = [];
    const client: MigrationLedgerClient = {
      query: async (sql) => {
        statements.push(sql);
        if (sql.includes('FROM schema_migrations') && sql.startsWith('SELECT')) {
          return { rows: applied, rowCount: applied.length };
        }
        if (sql.includes('DROP INDEX')) {
          throw new Error('simulated failure inside the rollback script');
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await expect(
      _rollBackMigration(client, '018_measurement_cohort_index.sql', false),
    ).rejects.toThrow(/simulated failure/);
    // The ledger row must survive a failed rollback: claiming a
    // migration is un-applied while its schema change is still live is
    // the mirror image of the bug this mode fixes.
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(statements.some((s) => s.startsWith('DELETE FROM schema_migrations'))).toBe(false);
  });

  it('refuses a migration that has no rollback script', async () => {
    const { client } = recordingClient([
      { id: '013_ai_audit_history_columns.sql', checksum: null },
    ]);
    // 003 deliberately has no _down: dropping the chat tables would
    // destroy data, not reverse a schema change.
    await expect(_rollBackMigration(client, '003_complete_chat_system.sql', false)).rejects.toThrow(
      /has no rollback script/,
    );
  });
});
