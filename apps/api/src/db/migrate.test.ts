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

  /* ------------------------------------------------------------------
   * Reading the CLAIM out of the prose, rather than the words.
   *
   * Everything below used to be a list of bans over the whole file's
   * text — `\bonly\b[^.]{0,20}\bwrites?\b`, `\b(?:is|are)\b[^.]{0,30}
   * \bavailable\b`, and six more. Each was written against one false
   * sentence and matched a character sequence, never asking whether the
   * sentence ASSERTED that sequence or DENIED it. So they banned the
   * honest correction as readily as the lie: 「Reads stop too, not only
   * writes」 — the title of the sibling test below — 「the table is not
   * available to readers」, 「Readers stay blocked until COMMIT」 and
   * 「reads remain queued behind the lock」 all went red on files that
   * were telling the truth. A guard that reddens the honest sentence is
   * deleted by the next author rather than fixed, and then the lie it
   * was written for walks back in.
   *
   * So polarity is read explicitly. Prose is cut into sentences, each
   * sentence into SEGMENTS at its subordinators and hard punctuation,
   * and inside a segment a claim is (subject × predicate × polarity):
   *
   *   reads/table/screen  +  「carries on」 verb   affirmative -> a lie
   *   reads/table/screen  +  「stops」 verb        negated     -> a lie
   *   either of those with the other polarity                 -> honest
   *
   * Segments, not clauses at every comma: 「reads are queued for a
   * moment and then go on as before」 has to stay banned, and cutting at
   * 「and」 strands the second half with no subject. Segments, not whole
   * sentences: 025 ships 「…reads included, because Postgres does not
   * let later lock requests overtake a waiting exclusive one」, where a
   * sentence-wide negator sits between a reads-noun and a stop-verb
   * that belong to different clauses. Cutting at 「because」 is what
   * keeps that honest sentence out of the ban.
   *
   * None of this is a claim to parse English. It is bounded pattern
   * matching with the polarity made explicit, and the thing that makes
   * the next widening safe is not the patterns but the fixture below:
   * every sentence in FALSE_REASSURANCE must be caught and every
   * sentence in HONEST must not, and both lists are real prose — the
   * lies out of 025's original text and this block's own history, the
   * honest ones out of the shipped 025 files.
   * ------------------------------------------------------------------ */

  const sentencesOf = (prose: string) =>
    prose
      // Not a bare `.`: these files are full of `1.5 ms`, `018.sql` and
      // `apps/api/src/db/migrate.ts`, and splitting inside those would
      // cut a subject away from its verb.
      .split(/(?<![0-9])[.!?](?![0-9])/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

  /** Subordinators and hard punctuation only. `and`/`but`/`,` are
   *  deliberately NOT breaks — a coordinated second half is still about
   *  the first half's subject. */
  const SEGMENT_BREAK =
    /[;:—–]|\s(?:because|while|which|that|though|although|unless|until|when|where|whereas|so)\s/i;

  const segmentsOf = (sentence: string) =>
    sentence
      .split(SEGMENT_BREAK)
      .map((segment) => (segment ?? '').trim())
      .filter(Boolean);

  /** What an availability claim can be ABOUT. Anything else in one of
   *  these files — the query, the plan, the index, the deploy — is not
   *  a reader, and a sentence about it makes no claim this block bans. */
  const READ_SUBJECT =
    /\b(?:SELECTs?|reads?|readers?|table|manage screen|screen|app|UI|clients?|callers?|users?|nothing|nobody|no one)\b/gi;

  const NEGATOR =
    /\b(?:not|never|no|none|nor|neither|nothing|nobody|cannot|can't|without)\b|n't\b/i;

  /** 「the table stays available」, 「reads still work」, 「invisible to
   *  readers」. The bare stative verbs are NOT here on their own: 「stay」
   *  in 「readers stay blocked」 says the opposite of 「stays available」,
   *  and putting `stays?` in a ban is what made finding 5 fire on the
   *  honest sentence. The claim is in the complement. */
  const CARRIES_ON =
    /\b(?:available|answering|serving|readable|online|reachable|unaffected|untouched|uninterrupted|unblocked|invisible|imperceptible|unnoticeable)\b|\b(?:keeps?|kept|stays?|stay|remains?|remain|is|are|still)\s+(?:working|works?|running|runs?|rendering|answering|serving|responding|up|available|readable|online)\b|\b(?:carry|carries) on\b|\bgo(?:es)? on\b|\bcontinues?\b|\bproceeds?\b/gi;

  /** The mirror. `locks?` is here so that 「does not lock the table」 and
   *  「holds no read lock」 are read as what they are: a stop, denied. */
  const STOPS =
    /\b(?:blocked|blocks?|stops?|stopped|stopping|stalls?|stalled|queues?|queued|waits?|waiting|pauses?|paused|cancell?ed|cancels?|unavailable|unreadable|unreachable|offline|locks?|locked)\b/gi;

  /** How far from its subject a predicate may sit and still be about
   *  it. 60 characters is what the bans this replaces used, and it is
   *  the distance across 「reads are queued for a moment and then go on
   *  as before」. */
  const SUBJECT_REACH = 60;

  /** How far in front of a claim a negator may sit and still be part of
   *  it: 「does not lock the table」, 「this file does not take the same
   *  SHARE lock」. Bounded rather than 「anywhere earlier in the
   *  segment」, because one segment can carry two claims and the first
   *  one's negator does not reach the second: 「the table is not
   *  available to readers, and it blocks SELECT」 is two honest halves,
   *  and reading the leading 「not」 as governing 「blocks SELECT」 turns
   *  the second half into a denied stop and reddens the whole
   *  sentence. */
  const NEGATOR_REACH = 24;

  /** The span a negator has to appear in to govern this predicate: from
   *  just before the claim to the predicate, and on past it to the end
   *  of its subject when the subject FOLLOWS the verb — 「blocks
   *  INSERT/UPDATE/DELETE but not SELECT」 negates the stop it just
   *  asserted. Null when no subject is near enough, i.e. when the
   *  segment makes no claim about readers at all. */
  const claimScopeOf = (segment: string, start: number, end: number) => {
    let best: { gap: number; start: number; end: number } | null = null;
    for (const subject of segment.matchAll(READ_SUBJECT)) {
      const from = subject.index;
      const to = from + subject[0].length;
      const gap = from >= end ? from - end : to <= start ? start - to : 0;
      if (gap > SUBJECT_REACH) continue;
      if (best === null || gap < best.gap) {
        best = { gap, start: Math.min(start, from), end: Math.max(end, to) };
      }
    }
    return best;
  };

  const negatedIn = (segment: string, scope: { start: number; end: number }) =>
    NEGATOR.test(segment.slice(Math.max(0, scope.start - NEGATOR_REACH), scope.end));

  type ReadClaim = 'carries-on' | 'stops' | 'none';

  const claimOf = (segment: string): ReadClaim => {
    let verdict: ReadClaim = 'none';
    for (const match of segment.matchAll(CARRIES_ON)) {
      const scope = claimScopeOf(segment, match.index, match.index + match[0].length);
      if (scope === null) continue;
      if (!negatedIn(segment, scope)) return 'carries-on';
      verdict = 'stops';
    }
    for (const match of segment.matchAll(STOPS)) {
      const scope = claimScopeOf(segment, match.index, match.index + match[0].length);
      if (scope === null) continue;
      if (negatedIn(segment, scope)) return 'carries-on';
      verdict = 'stops';
    }
    return verdict;
  };

  const segmentsClaiming = (text: string, claim: ReadClaim) =>
    sentencesOf(text).flatMap((sentence) =>
      segmentsOf(sentence).filter((segment) => claimOf(segment) === claim),
    );

  /** Says reads are among what stops — not merely that a lock is taken.
   *  Reached through the same classifier as the ban, so the two cannot
   *  disagree about one sentence: before, 「Reads stay blocked until
   *  COMMIT」 satisfied the ban on claiming reads carry on AND failed to
   *  satisfy this, which is a self-contradictory verdict on honest
   *  prose. */
  const statesReadsStop = (text: string) => segmentsClaiming(text, 'stops').length > 0;

  /** A ban on a fixed phrase, fired only where the segment ASSERTS it.
   *  `same SHARE lock` and 「ACCESS EXCLUSIVE … brief」 are claims about
   *  the lock's identity and duration rather than about readers, so the
   *  classifier above cannot reach them — but they have the same
   *  polarity problem: 「this file does not take the same SHARE lock 018
   *  took」 and 「the lock is not brief」 are the corrections. */
  const assertingSegments = (text: string, phrase: RegExp) =>
    sentencesOf(text).flatMap((sentence) =>
      segmentsOf(sentence).filter((segment) => {
        const match = segment.match(phrase);
        if (match?.index === undefined) return false;
        return !negatedIn(segment, { start: match.index, end: match.index + match[0].length });
      }),
    );

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

  /** The vocabulary a by-hand swap is written in, used by BOTH
   *  predicates below.
   *
   *  The swap is a SECOND transaction that opens with `DROP INDEX`, so
   *  it takes the same lock as the file itself; but it is not made of
   *  the file's own statements, so nothing above can see it. That is
   *  where 025's original text put its comfort — the swap was 「catalog
   *  work, not a build」 that 「neither reads nor writes stop for」 — and
   *  every check in this describe stayed green over it.
   *
   *  The two predicates used to disagree about what counts: the
   *  paragraph selector already counted 「second transaction」 while the
   *  trigger did not, so a file that handed the operator the same
   *  recipe under 「the by-hand alternative」 was skipped entirely.
   *  Reproduced against 025's _down script, which went straight back to
   *  the inherit-by-reference state it was corrected out of. One
   *  vocabulary fixes that; what it cannot fix on its own is the
   *  difference between naming a swap and offering one, which is what
   *  `swapOffers` below is for. */
  const SWAP_VOCABULARY =
    /\bhatch\b|\bswap\b|by[- ]hand|second transaction|RENAME TO|CREATE INDEX CONCURRENTLY/i;

  /** Denials of a swap, in the two shapes these files write them: a
   *  plain negator (「there is no by-hand alternative」, 「this file
   *  offers no escape hatch」, 「018's hatch does NOT carry over」) and
   *  the unavailability every file of this shape has to state about
   *  CONCURRENTLY (「cannot run inside a transaction」, 「is unavailable
   *  inside the runner's transaction」). */
  const SWAP_DENIAL = new RegExp(
    `${NEGATOR.source}|\\bunavailable\\b|\\bunusable\\b|\\bimpossible\\b|\\bforbid(?:s|den)?\\b|\\brules? out\\b`,
    'i',
  );

  /** Segments that OFFER the swap, rather than merely spelling its
   *  name. `offersASwap` used to be `SWAP_VOCABULARY.test(proseOf(sql))`
   *  over the whole file, and every file in this shape has to write
   *  「CREATE INDEX CONCURRENTLY cannot run inside a transaction」 to
   *  explain why it is not using one — 025 writes it verbatim. So the
   *  trigger fired on files offering nothing, and then demanded a
   *  paragraph describing the lock of a swap that does not exist. The
   *  only way to green that is to invent a swap or delete the guard,
   *  which is the opposite of what the comment two tests down promises
   *  (「a future migration in this shape that offers none makes no claim
   *  to check」). Both explicit denials — 「no escape hatch」, 「no by-hand
   *  alternative」 — were read as offers for the same reason. */
  const swapOffers = (sql: string) =>
    sentencesOf(proseOf(sql)).flatMap((sentence) =>
      segmentsOf(sentence).filter(
        (segment) => SWAP_VOCABULARY.test(segment) && !SWAP_DENIAL.test(segment),
      ),
    );

  const offersASwap = (sql: string) => swapOffers(sql).length > 0;

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
        statesReadsStop(paragraph),
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
      expect(statesReadsStop(claim), claim).toBe(true);
    }
  });

  /** Everything a file in this shape may not say, in a single list.
   *  The entries are not phrasings — they are the KINDS of claim the lock
   *  cannot support, and each is polarity-aware, so the correction of
   *  each is not on the list. How many kinds there are is derived from
   *  this array by the count test below rather than written into the
   *  sentence above it, which is how it came to say 「three」 over four
   *  of them. */
  const FALSE_REASSURANCE_KINDS: Array<(prose: string) => string[]> = [
    // The reassurance the lock cannot support: under ACCESS EXCLUSIVE
    // nothing reads the table, so no part of this file may tell an
    // operator that reads carry on — as an affirmative (「reads keep
    // working」, 「the table stays available」, 「invisible to readers」)
    // or as a denied stop (「neither reads nor writes stop for it」,
    // 「does not lock the table for reads」, 「nothing waits」). Read
    // file-wide on purpose: a file that says reads stop in one place
    // and reads keep working in another has not corrected anything.
    (prose) => segmentsClaiming(prose, 'carries-on'),
    // 「only writes」: the DROP's lock has no writers-only mode to fall
    // back to. Asserted only — 「Reads stop too, not only writes」 and
    // 「blocks SELECT, not only INSERT/UPDATE/DELETE」 are the sentences
    // this test is named after, and the ban used to reject both.
    (prose) => assertingSegments(prose, /\bonly\b[^.]{0,30}\b(?:INSERTs?|writes?)\b/i),
    // SHARE is what a lone CREATE INDEX takes; it is not available to a
    // file that dropped an index first in the same transaction.
    (prose) => assertingSegments(prose, /same SHARE lock/i),
    // 「briefly」 is true of a DROP on its own and false of a transaction
    // that holds the lock through an index build.
    (prose) => assertingSegments(prose, /ACCESS\s*EXCLUSIVE[^.]{0,40}\bbrief/i),
  ];

  const falseReassurances = (prose: string): string[] =>
    FALSE_REASSURANCE_KINDS.flatMap((kind) => kind(prose));

  it.each(rebuilders)('%s does not claim a lock this shape cannot take', (file) => {
    // Reported as the offending segments rather than as a regex that
    // did not match: the failure an author sees is the sentence they
    // wrote, which is the thing they have to decide about.
    expect(falseReassurances(proseOf(sqlOf(file)))).toEqual([]);
  });

  /**
   * The fixture the guard above is calibrated against.
   *
   * A ban over prose is only as good as the sentences it was tried on,
   * and this one was tried on exactly one file. Four rounds of widening
   * it against 025's original text left a guard that reddened on 「Reads
   * stop too, not only writes」 — a phrase the suite itself uses as a
   * test title — and on 「the table is not available to readers」, which
   * is the plainest true thing a file in this shape can say. Nobody
   * noticed, because the only prose it ever ran on was already written
   * around it.
   *
   * So both directions are pinned here, on sentences rather than on
   * files. FALSE_REASSURANCE is the archive, in two arrays because it
   * has two provenances: 025's original text, and every phrasing those
   * four rounds of widening were written for — the ones this block's
   * own comments quote as the belief it exists to prevent among them,
   * since a comment quoting a phrasing is how that phrasing is
   * recorded at all. HONEST is the corrections: the ones the shipped
   * 025 files use, and the true sentences the guard as it stood
   * rejected.
   *
   * FIXTURE: twenty banned sentences — three of them 025's own text and
   * seventeen from the four rounds of widening — and nineteen honest
   * ones, against four kinds of banned claim.
   * Stated here, and derived from the arrays by the last test in this
   * block, because the size of this fixture is the evidence offered
   * that the guard was recalibrated against every phrasing an earlier
   * widening was written for — and the one place it was written down,
   * the commit message that added the fixture, says twenty-two. A
   * number nobody can check is a number that is already wrong.
   *
   * That last point applies to this docblock too, which is why the
   * count test below does not stop at the FIXTURE line: it scans every
   * number word in this block's comments that is attached to something
   * countable here, and fails on any that no derivation accounts for.
   * A single `toContain` over one sentence is satisfied by a docblock
   * that contradicts itself two lines away, which is how 「seventeen
   * from the widening history」 came to sit under a three-part
   * enumeration and over an array split two ways.
   *
   * Both lists are about A FILE IN THIS SHAPE. 018 says 「reads of the
   * manage screen keep working while writes queue」 and is telling the
   * truth, because its lone CREATE INDEX takes SHARE; the same sentence
   * in a DROP-then-CREATE file is a lie. That is why the guard runs on
   * `rebuilders` and not on the directory.
   */
  /**
   * How many times the ban was widened against 025's original text
   * before this fixture existed. A fact about the guard's history, not
   * the size of anything here — so it is a named constant every
   * sentence stating it is built from, rather than a number retyped in
   * three paragraphs and contradicted by a fourth.
   */
  const WIDENING_ROUNDS = 4;

  /** 025 as it shipped, about its own swap transaction. */
  const FALSE_REASSURANCE_AS_SHIPPED = [
    'The swap is catalog work, not a build, and neither reads nor writes stop for it.',
    'This transaction takes the same SHARE lock 018 took.',
    'ACCESS EXCLUSIVE is held only briefly here.',
  ];

  /**
   * Each of these got past the ban list as it stood at some point
   * across those four rounds. NOT one phrasing per round — the version
   * of this comment that shipped said it was, which put 「seventeen」
   * and 「four」 in the same docblock for the same history. A round that
   * widens a regex is a round that has been shown several phrasings;
   * what is one-per-round is the widening, not the sentence.
   */
  const FALSE_REASSURANCE_PER_WIDENING = [
    'Reads continue throughout the swap.',
    'The swap does not lock the table for reads.',
    'The RENAME holds no read lock.',
    'The 1.8 ms swap is invisible to readers.',
    'The manage screen keeps rendering right through it.',
    'Nothing waits on it.',
    'The table stays available for the length of the build.',
    'The table keeps answering while the index is rebuilt.',
    'SELECTs are unaffected.',
    'Reads still work throughout.',
    'Reads carry on.',
    'The table is readable throughout the build.',
    // A stop, denied — the same claim as 「reads carry on」 reached from
    // the other side.
    'Readers are not blocked.',
    'It blocks INSERT/UPDATE/DELETE for the duration of the build but not SELECT.',
    // The stative verb is honest and the complement is not, so a ban
    // keyed on 「stay」/「keep」 alone cannot tell these from the HONEST
    // entries below.
    'Reads are queued for a moment and then go on as before.',
    'The lock blocks only writes.',
    'Only INSERT/UPDATE/DELETE queue behind it.',
  ];

  const FALSE_REASSURANCE = [...FALSE_REASSURANCE_AS_SHIPPED, ...FALSE_REASSURANCE_PER_WIDENING];

  const HONEST = [
    // True of a file in this shape, and rejected by the ban as it
    // stood. Findings 3-6 named two of them: 「Reads stop too, not only
    // writes」, which this suite uses as a test title, and 「the table is
    // not available to readers」, which is the plainest true thing such
    // a file can say. The rest are the same claim in the shapes a
    // correction reaches for; which of them the old guard would have
    // rejected is not recorded anywhere, so no count is stated here.
    'Reads stop too, not only writes.',
    'It blocks SELECT, not only INSERT/UPDATE/DELETE.',
    'During the build the table is not available to readers.',
    'Readers stay blocked until COMMIT.',
    'Reads remain queued behind the lock.',
    'No SELECT keeps running: the lock is held to COMMIT.',
    'The table is not readable until COMMIT.',
    'The table is unavailable to readers until COMMIT.',
    // Verbatim from the shipped 025 files. If the guard rejects these
    // it is rejecting the correction it was written to enforce.
    'The DROP takes ACCESS EXCLUSIVE on patient_measurements and holds it until COMMIT, so the CREATE after it builds under ACCESS EXCLUSIVE — which blocks SELECT as well as INSERT/UPDATE/DELETE.',
    '018 blocked writes only; this file stops the table dead for the length of the build.',
    'DROP 1.5 ms, CREATE 4.7 ms — so reads are blocked for about 6 ms at this size.',
    'Reads as well as writes stop for the length of the build.',
    'ACCESS EXCLUSIVE cannot be granted while any reader still holds ACCESS SHARE, so the DROP first has to queue behind whatever SELECT is already in flight.',
    'A plain SELECT count(*) issued after it was cancelled by a 2 s statement_timeout without ever running.',
    'Reads stop for it exactly as they stop for the CREATE.',
    // The corrections of the two phrase bans, which were as blind to
    // polarity as the read-claim ones.
    'This file does not take the same SHARE lock 018 took.',
    'ACCESS EXCLUSIVE is not brief here — it is held through the build.',
    // Neither of these is about readers at all, and both carry a
    // negator and a stop-verb in one sentence.
    'Postgres does not let later lock requests overtake a waiting exclusive one.',
    'Nothing reads the table while the lock is held.',
  ];

  it.each(FALSE_REASSURANCE)('bans 「%s」', (sentence) => {
    expect(falseReassurances(sentence)).not.toHaveLength(0);
  });

  it('states the size of its own fixture, and states it right', () => {
    const words = [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
      'thirteen',
      'fourteen',
      'fifteen',
      'sixteen',
      'seventeen',
      'eighteen',
      'nineteen',
      'twenty',
      'twenty-one',
      'twenty-two',
      'twenty-three',
      'twenty-four',
    ];
    /** A number word, or a loud failure rather than `undefined`. */
    const word = (value: number): string => {
      expect(words[value], `no number word for ${value}; extend the list`).toBeDefined();
      return words[value];
    };
    // Doc comments with their wrapping removed, which is how the
    // sentence above is written and how a reader reads it.
    const prose = fs
      .readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .replace(/\n\s*\*\s?/g, ' ');

    /**
     * Every count this block's comments state about this fixture. The
     * version of this test that shipped derived the FIXTURE line and
     * nothing else, so 「Four rounds of widening」 two paragraphs up,
     * 「the three entries」 over an array of four and 「The four
     * sentences」 over an array of eight all stayed invisible — a
     * `toContain` is satisfied by one true sentence however many false
     * ones sit beside it.
     */
    const DERIVED = [
      `FIXTURE: ${word(FALSE_REASSURANCE.length)} banned sentences — ` +
        `${word(FALSE_REASSURANCE_AS_SHIPPED.length)} of them 025's own text and ` +
        `${word(FALSE_REASSURANCE_PER_WIDENING.length)} from the ${word(WIDENING_ROUNDS)} rounds of widening — ` +
        `and ${word(HONEST.length)} honest ones, against ` +
        `${word(FALSE_REASSURANCE_KINDS.length)} kinds of banned claim.`,
      `${word(WIDENING_ROUNDS).replace(/^./, (c) => c.toUpperCase())} rounds of widening it against 025's original text`,
      `every phrasing those ${word(WIDENING_ROUNDS)} rounds of widening were written for`,
      `got past the ban list as it stood at some point across those ${word(WIDENING_ROUNDS)} rounds`,
    ];
    DERIVED.forEach((statement) => expect(prose, statement).toContain(statement));

    /**
     * And the other direction: a number word next to something this
     * block counts, that no derivation above accounts for. Coverage is
     * by removal rather than by containment, so a new sentence cannot
     * ride on a phrasing already approved somewhere else.
     */
    const COUNTS_SOMETHING = new RegExp(
      `\\b(?:${words.join('|')})\\b(?:\\W+\\w+){0,3}?\\W+` +
        `(?:sentences|entries|phrasings?|rounds?|kinds?|honest)\\b`,
      'gi',
    );
    /**
     * Number words in this block's comments that are not counting this
     * fixture: the counts this block records as WRONG, quoted, plus the
     * sentence that denies a one-to-one match between the archive and
     * the widening history. A
     * quotation must not track the arrays — that is what makes it a
     * quotation — so each is listed rather than derived, and each is
     * marked with 「」 or with the denial around it.
     */
    const NOT_THE_FIXTURE = [
      'says twenty-two',
      'NOT one phrasing per round',
      'what is one-per-round is the widening',
      '「Four rounds of widening」',
      '「the three entries」 over an array of four',
      '「The four sentences」 over an array of eight',
    ];
    // From the ban's own doc comment, not from the fixture's: the
    // miscount over the KINDS array sits above the fixture, and a scan
    // that started at the fixture could not see it.
    const block = prose.slice(prose.indexOf('Everything a file in this shape may not say'));
    const covered = [...DERIVED, ...NOT_THE_FIXTURE];
    const unaccounted = [
      ...covered
        .reduce((rest, statement) => rest.split(statement).join(' … '), block)
        .matchAll(COUNTS_SOMETHING),
    ].map((match) => match[0]);
    expect(unaccounted, 'counts stated in this block that nothing here derives').toEqual([]);
  });

  it.each(HONEST)('leaves 「%s」 alone', (sentence) => {
    expect(falseReassurances(sentence)).toEqual([]);
  });

  it.each([
    'Readers stay blocked until COMMIT.',
    'Reads remain queued behind the lock.',
    'The table is not available to readers until COMMIT.',
    'The table is unavailable to readers until COMMIT.',
    'Reads as well as writes stop for the length of the build.',
    'It blocks SELECT as well as INSERT/UPDATE/DELETE.',
  ])('counts 「%s」 as saying reads stop', (sentence) => {
    // The other half of the same classifier. These went red on
    // 「%s says reads stop too」 while ALSO going red on the ban above —
    // one file, two contradictory verdicts, both on honest prose.
    expect(statesReadsStop(sentence)).toBe(true);
  });

  it.each([
    '018 blocked writes only.',
    'The DROP takes ACCESS EXCLUSIVE on patient_measurements and holds it until COMMIT.',
    'The build runs under the lock the DROP took.',
  ])('does not accept 「%s」 as saying reads stop', (sentence) => {
    // Naming the lock, or naming what stops for writers, is the claim
    // this suite exists to say is not enough.
    expect(statesReadsStop(sentence)).toBe(false);
  });

  it.each([
    'Not CONCURRENTLY, for 018s reason: the runner wraps each file in one BEGIN/COMMIT, and CREATE INDEX CONCURRENTLY cannot run inside a transaction.',
    'CREATE INDEX CONCURRENTLY is unavailable inside the runner transaction.',
    'There is no by-hand alternative here; run it in the deploy window.',
    'This file offers no escape hatch.',
    "018's by-hand escape hatch does NOT carry over to this file.",
  ])('does not read 「%s」 as offering a swap', (sentence) => {
    // Every file in this shape has to write the first of these. Reading
    // it as an offer is what made the swap-lock test demand a paragraph
    // about a swap the file does not have.
    expect(offersASwap(`-- ${sentence}`)).toBe(false);
  });

  it.each([
    'Outside any transaction: CREATE INDEX CONCURRENTLY idx_cohort_v2 ON patient_measurements (muscle_group);',
    'ALTER INDEX idx_cohort_v2 RENAME TO idx_cohort;',
    'At a size where the window matters, the swap has to REPLACE this file rather than precede it.',
    "The forward file's escape hatch works here too, with two changes.",
    'That second transaction opens with a DROP INDEX.',
  ])('reads 「%s」 as offering a swap', (sentence) => {
    // Including the by-reference form, which is the state the _down
    // script shipped in and the reason the trigger was widened at all.
    expect(offersASwap(`-- ${sentence}`)).toBe(true);
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
    // Asserted only, like the phrase bans above: 「do not see 018 for the
    // escape hatch, it does not survive this DROP」 is the warning, not
    // the pointer.
    expect(assertingSegments(prose, /see \d{3} for the (?:by-hand )?(?:escape )?hatch/i)).toEqual(
      [],
    );
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
