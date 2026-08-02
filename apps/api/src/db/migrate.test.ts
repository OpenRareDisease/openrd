import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { _hasSelfManagedTransaction, _isForwardMigrationFile } from './migrate.js';

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
