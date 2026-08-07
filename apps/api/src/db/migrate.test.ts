import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  _decodeSqlBuffer,
  _downFilenameFor,
  _findOrphanLedgerIds,
  _hasSelfManagedTransaction,
  _isForwardMigrationFile,
  _laterMigrationsStillApplied,
  _resolveDownTarget,
  _rollBackMigration,
  _stripSqlComments,
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
    // Decoded with the runner's OWN decoder, not a copy of it. This test
    // used to carry a second one — an LE-BOM-only ternary with no BOM
    // strip — while readSqlFile also handles the UTF-16BE BOM. A
    // migration saved as 「Unicode big endian」 (the same Notepad route
    // that produced 003_complete_chat_system.sql) containing BEGIN;
    // decoded here as NUL-interleaved mojibake, the regex silently
    // missed it, and CI went green on a file that throws inside the
    // container CMD at deploy time. A false pass, the worst kind — which
    // is what the old comment claimed to prevent.
    const sql = _decodeSqlBuffer(fs.readFileSync(path.join(migrationsDir, file)));
    expect(_hasSelfManagedTransaction(sql)).toBe(false);
  });
});

describe('_decodeSqlBuffer', () => {
  // The corpus test above is only as good as this. Each encoding is
  // asserted to round-trip a statement the guard must SEE, so a
  // regression here shows up as a decoder failure rather than as a
  // silently-passing corpus.
  const statement = 'BEGIN;\nALTER TABLE t ADD COLUMN y INT;\nCOMMIT;\n';

  /** U+FEFF written as an escape: an invisible literal in the source
   *  is exactly the kind of thing that gets lost in a copy-paste. */
  const BOM = '\uFEFF';

  const utf16be = (text: string) => {
    const le = Buffer.from(`${BOM}${text}`, 'utf16le');
    const be = Buffer.from(le);
    for (let index = 0; index + 1 < be.length; index += 2) {
      const current = be[index];
      be[index] = be[index + 1];
      be[index + 1] = current;
    }
    return be;
  };

  it('decodes plain UTF-8', () => {
    expect(_decodeSqlBuffer(Buffer.from(statement, 'utf8'))).toBe(statement);
  });

  it('strips a UTF-8 BOM so the leading keyword is still statement-leading', () => {
    const withBom = Buffer.from(`${BOM}${statement}`, 'utf8');
    expect(_decodeSqlBuffer(withBom)).toBe(statement);
    expect(_hasSelfManagedTransaction(_decodeSqlBuffer(withBom))).toBe(true);
  });

  it('decodes UTF-16LE (the encoding 003_complete_chat_system.sql is in)', () => {
    const le = Buffer.from(`${BOM}${statement}`, 'utf16le');
    expect(_decodeSqlBuffer(le)).toBe(statement);
    expect(_hasSelfManagedTransaction(_decodeSqlBuffer(le))).toBe(true);
  });

  it('decodes UTF-16BE — the branch the old test-local decoder was missing', () => {
    const be = utf16be(statement);
    // What the old decoder did with these bytes: mojibake, and the guard
    // returns false on it.
    expect(_hasSelfManagedTransaction(be.toString('utf8'))).toBe(false);
    // What the runner does, and now what the test does.
    expect(_decodeSqlBuffer(be)).toBe(statement);
    expect(_hasSelfManagedTransaction(_decodeSqlBuffer(be))).toBe(true);
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
 * Locks compose inside the runner's transaction, so a migration that
 * describes them statement by statement gets the answer wrong.
 *
 * applyPendingMigrations wraps a whole file in one BEGIN/COMMIT. A file
 * that drops an index and then creates one is therefore not taking two
 * locks in turn: the DROP's ACCESS EXCLUSIVE on the table is held until
 * COMMIT, and the CREATE builds under it. That blocks SELECT as well as
 * INSERT/UPDATE/DELETE — a different outage from the SHARE lock a lone
 * CREATE INDEX takes, and a different thing to plan a deploy around.
 *
 * 025 shipped saying the opposite: 「the same SHARE lock as 018 — see
 * 018 for the by-hand escape hatch … The DROP below takes ACCESS
 * EXCLUSIVE, briefly」. An operator reading that budgets for a window
 * that stops writes when it stops reads, and following the pointer to
 * 018's CONCURRENTLY hatch makes it worse rather than better: 025's
 * unconditional DROP removes the hand-built index and rebuilds it
 * non-concurrently under the full lock.
 *
 * Measured on PG18 against dev (patient_measurements, 233 rows) by
 * holding the transaction open and reading pg_locks from a second
 * session: AccessExclusiveLock granted on the table and still held
 * after the CREATE had run, alongside the build's own ShareLock; a
 * plain `SELECT count(*)` from that second session never returned and
 * was cancelled by a 2s statement_timeout.
 *
 * The lock's CONSEQUENCE is guarded separately from its name and its
 * duration, because 025's correction got the first two right and then
 * described its own escape-hatch swap — a transaction opening with
 * `DROP INDEX` — as work 「neither reads nor writes stop for」. Both
 * halves are checkable independently and a file can pass either while
 * failing the other, so both are checked.
 *
 * The swap is checked in its own right too. It is not made of the
 * file's statements, so the paragraph selector cannot reach it by
 * looking at what the file does; and the sentence that describes it is
 * the one an operator acts on by hand, against a live database. So a
 * file that offers a swap — or borrows the neighbouring file's — has to
 * carry the swap's lock in a paragraph of its own, which is what the
 * _down script did not do while its forward sibling covered for it.
 *
 * Which files are held to this is derived from the statements rather
 * than listed, so migration 026 is covered the day someone writes it in
 * this shape. The assertions are on claims a file in this shape cannot
 * honestly make, not on any particular wording of the correction.
 */
describe('a migration that rebuilds an index describes the lock it really takes', () => {
  const migrationsDir = path.resolve(__dirname, '../../../../db/migrations');

  const sqlOf = (file: string) => _decodeSqlBuffer(fs.readFileSync(path.join(migrationsDir, file)));

  /** The comment text as a reader meets it: `--` markers dropped and
   *  wrapped lines rejoined, so a sentence split across three lines is
   *  one string here as it is one sentence on screen. */
  const commentLinesOf = (sql: string) =>
    sql
      .split('\n')
      .filter((line) => line.trimStart().startsWith('--'))
      .map((line) => line.trimStart().replace(/^--\s?/, ''));

  const proseOf = (sql: string) => commentLinesOf(sql).join(' ').replace(/\s+/g, ' ');

  /** The same text cut at the blank `--` lines, so an assertion can ask
   *  about the paragraph that makes a claim rather than about the file.
   *  Whole-file matching is too weak here: 025's original text named
   *  ACCESS EXCLUSIVE in one paragraph and described a catalog blip in
   *  another, and every file-global check it had stayed green. */
  const paragraphsOf = (sql: string) =>
    commentLinesOf(sql)
      .join('\n')
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

  /** Paragraphs that describe the composition itself — this lock, over
   *  this DROP, with a build or a rename after it. Those are the ones an
   *  operator budgets a deploy from, so those are the ones held to the
   *  consequence. A heading or a recipe listing naming only one of the
   *  three is not making the claim.
   *
   *  The lock name is matched in both spellings a writer reaches for:
   *  `ACCESS EXCLUSIVE` as the SQL level and `AccessExclusiveLock` as
   *  pg_locks prints it. Matching only the first left the paragraph that
   *  quotes pg_locks outside every assertion here. */
  const claimParagraphs = (sql: string) =>
    paragraphsOf(sql).filter(
      (paragraph) =>
        /ACCESS\s*EXCLUSIVE/i.test(paragraph) &&
        /\bDROP\b/.test(paragraph) &&
        /\bCREATE\b|\bbuilds?\b|\bRENAME\b/.test(paragraph),
    );

  /** Says reads are among what stops — not merely that a lock is taken. */
  const statesReadsStop =
    /\b(?:blocks?|stops?|stopped|stopping|cancell?ed|cancels?)\b[^.]{0,40}\b(?:SELECTs?|reads?|readers?)\b|\b(?:SELECTs?|[Rr]eads?)\b[^.]{0,60}\b(?:blocked|blocks?|stops?|stop|queue|queues|cancell?ed)\b/;

  /** True when the runner's single transaction leaves the index build
   *  running under an earlier statement's ACCESS EXCLUSIVE. Statements
   *  are split with the runner's own comment stripper so a `DROP INDEX`
   *  quoted in prose does not count as one. */
  const buildsIndexUnderAccessExclusive = (sql: string) => {
    const statements = _stripSqlComments(sql)
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const exclusive = statements.findIndex((s) => /^DROP\s+INDEX\b/i.test(s));
    const build = statements.findIndex((s) => /^CREATE\s+INDEX\b/i.test(s));
    return exclusive >= 0 && build > exclusive;
  };

  /** True when the file hands the operator a by-hand swap — spelled out
   *  as a recipe, or borrowed from the neighbouring file by reference.
   *  The swap is a SECOND transaction that opens with `DROP INDEX`, so
   *  it takes the same lock as the file itself; but it is not made of
   *  the file's own statements, so nothing above can see it. That is
   *  where 025's original text put its comfort — the swap was 「catalog
   *  work, not a build」 that 「neither reads nor writes stop for」 — and
   *  every check in this describe stayed green over it. */
  /** One vocabulary, used by BOTH predicates below.
   *
   *  They disagreed: `swapLockParagraphs` already counted 「second
   *  transaction」 as naming a swap while `offersASwap` did not, and
   *  `offersASwap` is the trigger — so a file that handed the operator
   *  the same recipe under 「the by-hand alternative」 was skipped
   *  entirely and every assertion in this describe stayed green over
   *  it. Reproduced against 025's _down script, which went straight
   *  back to the inherit-by-reference state it was corrected out of. */
  const SWAP_VOCABULARY =
    /\bhatch\b|\bswap\b|by[- ]hand|second transaction|RENAME TO|CREATE INDEX CONCURRENTLY/i;

  const offersASwap = (sql: string) => SWAP_VOCABULARY.test(proseOf(sql));

  /** Paragraphs that state the swap's lock in full: the lock's name,
   *  that it is held to COMMIT, and that reads stop for it. All three in
   *  ONE paragraph that names the swap, because the honest sentences
   *  about the file's own DROP live in a different paragraph and
   *  borrowing them is exactly how the _down script passed while
   *  carrying no caveat of its own. */
  const swapLockParagraphs = (sql: string) =>
    paragraphsOf(sql).filter(
      (paragraph) =>
        SWAP_VOCABULARY.test(paragraph) &&
        /ACCESS\s*EXCLUSIVE/i.test(paragraph) &&
        /until COMMIT|still held|through the build/i.test(paragraph) &&
        statesReadsStop.test(paragraph),
    );

  const rebuilders = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .filter((file) => buildsIndexUnderAccessExclusive(sqlOf(file)));

  it('finds the migrations in that shape', () => {
    expect(rebuilders).toContain('025_measurement_cohort_index_per_patient.sql');
    // The rollback script has the same shape and the same lock, which
    // is why it is held to the same rule rather than exempted for being
    // hand-run.
    expect(rebuilders).toContain('025_measurement_cohort_index_per_patient_down.sql');
  });

  it.each(rebuilders)('%s says the exclusive lock outlives the DROP', (file) => {
    const claims = claimParagraphs(sqlOf(file));
    // A file in this shape has to make the claim somewhere.
    expect(claims.length).toBeGreaterThan(0);
    // Naming the lock is not enough — 025 named it and still described a
    // catalog blip. The paragraph making the claim has to say the lock
    // is held across the build, and has to say it itself: borrowing
    // 「until COMMIT」 from an unrelated paragraph elsewhere in the file
    // is how the original text passed.
    for (const claim of claims) {
      expect(claim).toMatch(/until COMMIT|still held|through the build/i);
    }
  });

  it.each(rebuilders)('%s says reads stop too, not only writes', (file) => {
    // The half with the operational teeth. The lock's NAME and DURATION
    // are both compatible with the outage an operator already knows —
    // writes queue, the manage screen keeps rendering — and that is the
    // budget they will set unless the text says otherwise. So the
    // paragraph that makes the claim has to name reads among what stops.
    for (const claim of claimParagraphs(sqlOf(file))) {
      expect(claim).toMatch(statesReadsStop);
    }
  });

  it.each(rebuilders)('%s does not claim a lock this shape cannot take', (file) => {
    const prose = proseOf(sqlOf(file));
    // SHARE is what a lone CREATE INDEX takes; it is not available to a
    // file that dropped an index first in the same transaction.
    expect(prose).not.toMatch(/same SHARE lock/i);
    // 「briefly」 is true of a DROP on its own and false of a transaction
    // that holds the lock through an index build.
    expect(prose).not.toMatch(/ACCESS EXCLUSIVE[^.]{0,40}\bbrief/i);
    // The reassurance the lock cannot support, in any paragraph: under
    // ACCESS EXCLUSIVE nothing reads the table, so no part of this file
    // may tell an operator that reads carry on. Checked file-wide on
    // purpose — a file that says reads stop in one place and reads keep
    // working in another has not corrected anything.
    expect(prose).not.toMatch(
      /\b(?:SELECTs?|reads?|readers?)\b[^.]{0,60}\b(?:keeps?|stays?|remains?|unaffected|untouched|carry on|still (?:work|works|run|runs))\b/i,
    );
    // 「only writes」 in any spelling: the DROP's lock does not have a
    // writers-only mode to fall back to.
    expect(prose).not.toMatch(/\bonly\b[^.]{0,30}\bINSERT\b/i);
    expect(prose).not.toMatch(/\bonly\b[^.]{0,20}\bwrites?\b/i);
    // The same reassurance in negative form — 「neither reads nor writes
    // stop for it」. It names no lock and uses none of the verbs above,
    // which is how the original text about the swap transaction passed
    // every check in this describe.
    expect(prose).not.toMatch(
      /\b(?:neither|nothing|not)\b[^.]{0,40}\b(?:reads?|writes?|SELECTs?)\b[^.]{0,50}\b(?:stops?|blocked|blocks?|pauses?|waits?|queues?)\b/i,
    );
    // ACCESS EXCLUSIVE is a lock on the TABLE. A bare RENAME takes
    // ShareUpdateExclusive on the index only — true, and irrelevant to
    // any transaction that opened with a DROP INDEX.
    expect(prose).not.toMatch(/no lock on the table/i);
    // The same denial reached without naming reads at all: the table
    // 「keeps answering」, 「stays available」, 「nothing waits」. These are
    // what the sentence above becomes once its banned words are gone,
    // and they are false for the same reason — the lock is on the table
    // and it is held to COMMIT.
    expect(prose).not.toMatch(
      /\b(?:keeps?|stays?|stay|remains?|is|are)\b[^.]{0,30}\b(?:available|answering|serving|readable|online|reachable)\b/i,
    );
    expect(prose).not.toMatch(
      /\b(?:nothing|nobody|no one)\b[^.]{0,40}\b(?:waits?|blocked|blocks?|queues?|stops?|stalls?)\b/i,
    );
    // 「Reads continue throughout the swap」 — the affirmative that needs
    // none of the verbs above. Plainer than any of them, and it passed.
    expect(prose).not.toMatch(
      /\b(?:reads?|SELECTs?|readers?)\b[^.]{0,40}\b(?:continue|continues|proceed|proceeds|go on|goes on)\b/i,
    );
    // 「does not lock the table for reads」 / 「holds no read lock」. The
    // negative-form check above wants a stop-verb AFTER the noun, so
    // both of these slipped past it.
    expect(prose).not.toMatch(
      /\bdoes not (?:lock|block)\b[^.]{0,40}\b(?:table|reads?|SELECTs?|readers?)\b/i,
    );
    expect(prose).not.toMatch(/\b(?:no|without a)\b[^.]{0,20}\bread lock\b/i);
    // 「the 1.8 ms swap is invisible to readers」 — a duration reframed
    // as an absence of consequence. The duration may be honest; the
    // conclusion is not, because the wait is unbounded behind whatever
    // is already reading.
    expect(prose).not.toMatch(
      /\b(?:invisible|imperceptible|unnoticeable)\b[^.]{0,30}(?:to )?\b(?:readers?|reads?|clients?|callers?|users?)\b/i,
    );
    // 「the manage screen keeps rendering right through it」. This one is
    // the sentence THIS TEST'S OWN comment uses to describe the false
    // belief it exists to prevent, and it passed every assertion above.
    expect(prose).not.toMatch(
      /\b(?:manage screen|table|screen|app|UI)\b[^.]{0,30}\b(?:keeps?|goes on|carries on)\b[^.]{0,20}\b(?:rendering|answering|working|serving|responding)\b/i,
    );
  });

  it.each(rebuilders)('%s says what the by-hand swap it offers locks', (file) => {
    const sql = sqlOf(file);
    // Only files that offer a swap, or borrow the neighbouring file's,
    // are held to this — a future migration in this shape that offers
    // none makes no claim to check.
    if (!offersASwap(sql)) return;
    // The swap is the ONE thing in these files an operator runs by hand
    // on a live database, and it opens with the same DROP INDEX the file
    // does. A file that hands it over without saying so is describing a
    // window that does not exist. Both 025 files own this sentence
    // themselves; inheriting it from the forward file by reference is
    // the state the _down script shipped in.
    expect(swapLockParagraphs(sql)).not.toHaveLength(0);
  });

  it('does not send the operator after a 42703 the _down hatch cannot raise', () => {
    const forward = '025_measurement_cohort_index_per_patient.sql';
    const down = '025_measurement_cohort_index_per_patient_down.sql';
    // 42703 is 「column does not exist」: the forward hatch's ledger
    // INSERT names `checksum`, and a ledger old enough to predate that
    // column rejects the statement. The _down hatch DELETEs its ledger
    // row instead, and a DELETE names no columns — so the workaround
    // does not carry over, and pointing the operator at it sends them to
    // edit a statement that was never going to fail.
    const downProse = proseOf(sqlOf(down));
    expect(downProse).toMatch(/\bDELETE\b[^.]{0,80}schema_migrations/);
    expect(downProse).not.toMatch(/INSERT INTO schema_migrations/);

    const clauses = paragraphsOf(sqlOf(forward)).filter((paragraph) => paragraph.includes('42703'));
    // The hatch does not work on an old ledger without this explanation,
    // so it has to be there for the rest of the check to mean anything.
    expect(clauses).not.toHaveLength(0);
    for (const clause of clauses) {
      if (!/_down/.test(clause)) continue;
      // If it mentions the _down script at all it has to name the DELETE
      // that exempts it, rather than extending the INSERT's fix to it.
      expect(clause).toMatch(/\bDELETE\b/);
      expect(clause).not.toMatch(/same treatment|same shape/i);
    }
  });

  it.each(rebuilders)('%s does not forward the reader to a hatch its own DROP defeats', (file) => {
    const prose = proseOf(sqlOf(file));
    // 018's escape hatch is "build it CONCURRENTLY by hand and let the
    // IF NOT EXISTS become the no-op that records it". A DROP above the
    // CREATE deletes the hand-built index first, so a file in this shape
    // has to carry its own hatch instead of pointing at another file's.
    expect(prose).not.toMatch(/see \d{3} for the (?:by-hand )?(?:escape )?hatch/i);
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

  it('refuses to roll back under a migration that is still applied', async () => {
    // 016's down script does `DROP COLUMN IF EXISTS deleted_at` on
    // patient_function_tests; 017 built a partial index on that column
    // (`… WHERE not_applicable AND deleted_at IS NULL`). Rolling 016
    // back with 017 applied CASCADEs 017's index away, prints success,
    // and the roll-forward re-applies 016 only — because 017's ledger
    // row is still there. The index never comes back while --status
    // reports 017 as applied.
    const { client, statements } = recordingClient([
      { id: '016_followup_record_soft_delete.sql', checksum: null },
      { id: '017_function_test_not_applicable.sql', checksum: null },
      { id: '018_measurement_cohort_index.sql', checksum: null },
    ]);

    await expect(
      _rollBackMigration(client, '016_followup_record_soft_delete.sql', false),
    ).rejects.toThrow(/017_function_test_not_applicable\.sql, 018_measurement_cohort_index\.sql/);
    // Nothing may have been executed: the point is that the CASCADE
    // never happens, not that it is reported afterwards.
    expect(statements.map((s) => s.sql)).not.toContain('BEGIN');
  });

  it('allows rolling back the highest applied migration', async () => {
    const { client, statements } = recordingClient([
      { id: '016_followup_record_soft_delete.sql', checksum: null },
      { id: '018_measurement_cohort_index.sql', checksum: null },
    ]);
    await _rollBackMigration(client, '018_measurement_cohort_index.sql', false);
    expect(statements.map((s) => s.sql)).toContain('COMMIT');
  });

  it('--force overrides the still-applied refusal', async () => {
    // The operator has established that nothing above depends on it —
    // the same escape hatch the missing-ledger-row refusal already has.
    const { client, statements } = recordingClient([
      { id: '018_measurement_cohort_index.sql', checksum: null },
      { id: '019_legal_document_acceptances.sql', checksum: null },
    ]);
    await _rollBackMigration(client, '018_measurement_cohort_index.sql', true);
    expect(statements.map((s) => s.sql)).toContain('COMMIT');
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

/*
 * Ledger rows with no file behind them.
 *
 * `--status` iterated the DISK listing and looked each file up in the
 * ledger, so a ledger id with no file was structurally invisible. On any
 * environment deployed before PR #58 that is not hypothetical: those
 * databases carry `011_status_check_constraints_down.sql` and
 * `012_text_column_constraints_down.sql` as applied rows — the down
 * scripts ran as forwards on the same boot — and the schema carries none
 * of the v2.4.0 CHECK constraints or the same-profile trigger. `--status`
 * printed `applied  011_…` / `applied  012_…` and never mentioned the
 * ghosts; the drift column could not flag them either, because rows that
 * old predate the checksum column and get no verdict at all.
 */
describe('migrate — _findOrphanLedgerIds', () => {
  const files = [
    '011_status_check_constraints.sql',
    '012_text_column_constraints.sql',
    '018_measurement_cohort_index.sql',
  ];

  it('finds the ghost _down rows a pre-#58 database carries', () => {
    expect(
      _findOrphanLedgerIds(
        [
          '000_init_db_bootstrap',
          '011_status_check_constraints.sql',
          '011_status_check_constraints_down.sql',
          '012_text_column_constraints.sql',
          '012_text_column_constraints_down.sql',
        ],
        files,
      ),
    ).toEqual(['011_status_check_constraints_down.sql', '012_text_column_constraints_down.sql']);
  });

  it('does not treat the bootstrap pseudo-entry as an orphan', () => {
    // It has no single source file by design — init_db.sql is extracted,
    // not listed — so flagging it would make every healthy database
    // report an orphan and train the operator to ignore the column.
    expect(_findOrphanLedgerIds(['000_init_db_bootstrap'], files)).toEqual([]);
  });

  it('reports a ledger row whose migration file was deleted', () => {
    expect(_findOrphanLedgerIds(['013_removed_by_a_rebase.sql'], files)).toEqual([
      '013_removed_by_a_rebase.sql',
    ]);
  });

  it('is silent on a healthy ledger', () => {
    expect(_findOrphanLedgerIds([...files, '000_init_db_bootstrap'], files)).toEqual([]);
  });
});

describe('migrate — _laterMigrationsStillApplied', () => {
  it('names every forward migration applied above the target', () => {
    expect(
      _laterMigrationsStillApplied('016_followup_record_soft_delete.sql', [
        '015_function_test_unit_constraint.sql',
        '016_followup_record_soft_delete.sql',
        '018_measurement_cohort_index.sql',
        '017_function_test_not_applicable.sql',
      ]),
    ).toEqual(['017_function_test_not_applicable.sql', '018_measurement_cohort_index.sql']);
  });

  it('ignores the bootstrap entry and ghost _down rows', () => {
    // Neither is something an operator can roll back in order, so
    // reporting them would force --force in the one case where the real
    // answer is to clean the ledger instead.
    expect(
      _laterMigrationsStillApplied('016_followup_record_soft_delete.sql', [
        '000_init_db_bootstrap',
        '017_function_test_not_applicable_down.sql',
      ]),
    ).toEqual([]);
  });

  it('is empty for the highest applied migration', () => {
    expect(
      _laterMigrationsStillApplied('018_measurement_cohort_index.sql', [
        '015_function_test_unit_constraint.sql',
        '018_measurement_cohort_index.sql',
      ]),
    ).toEqual([]);
  });
});
