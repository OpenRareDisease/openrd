import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { _decodeSqlBuffer, _stripSqlComments } from './migrate.js';

/**
 * A migration that reports something an operator is told to act on has to
 * report it at a severity the operator will actually receive.
 *
 * Three channels, and the deploy path this repo documents uses exactly
 * one of them. Measured on the dev PostgreSQL 18 with the stock
 * `log_min_messages = warning` / `client_min_messages = notice` that
 * nothing in this repo overrides (no postgresql.conf, no `command:` on
 * the compose postgres service), by raising all four levels inside one DO
 * block and diffing the bytes appended to the server log:
 *
 *              server log     psql client     npm run db:migrate
 *   NOTICE         no             yes                no
 *   INFO           no             yes                no
 *   LOG           yes              no                no
 *   WARNING       yes             yes                no
 *
 * `npm run db:migrate` is `no` across the board: apps/api/src/db/migrate.ts
 * never subscribes to node-postgres's `notice` event, so it prints
 * `Applied <file>` and nothing else. That leaves the server log as the
 * only channel on the documented path, and WARNING as the only level that
 * reaches it while still showing up for an operator applying the file by
 * hand with `psql -f`.
 *
 * 022_patient_instruments.sql is why this file exists. Its DO block
 * counted rows outside the new muscle_group CHECK and told the operator
 * to read the server log — but its clean-table branch raised NOTICE, so
 * the one result the file gates on ("if it reports zero, promote the
 * constraint") was the one result that reached no log at all. On dev,
 * `patient_measurements_muscle_group_check` is still NOT VALID.
 */
const DISCARDED_BY_DEFAULT = new Set(['NOTICE', 'INFO', 'DEBUG']);

export const _raisesDiscardedByDefaultLogging = (sql: string): string[] =>
  // Case-insensitive: PL/pgSQL is, so `raise notice` is the same
  // statement and would otherwise walk straight past an uppercase-only
  // guard.
  [..._stripSqlComments(sql).matchAll(/\bRAISE\s+([A-Za-z_]+)/gi)]
    .map((m) => m[1].toUpperCase())
    // `RAISE EXCEPTION`, `RAISE WARNING`, `RAISE LOG` and bare `RAISE`
    // (re-raise, and no capture) are all fine. So is `RAISE NOTICE`
    // written inside a comment — comments are stripped first, precisely
    // so the files may go on explaining the trade-off in prose.
    .filter((level) => DISCARDED_BY_DEFAULT.has(level));

describe('every RAISE in a migration reaches the server log', () => {
  const migrationsDir = path.resolve(__dirname, '../../../../db/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    // `_down.sql` files are included deliberately. They are the scripts
    // run at the worst moment, by hand, when something is already wrong —
    // 015's down twin had this same defect on its "units restored"
    // branch, where the alternative outcome is "the units are gone".
    .sort();

  it('finds the migrations directory', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s', (file) => {
    const sql = _decodeSqlBuffer(fs.readFileSync(path.join(migrationsDir, file)));
    expect(_raisesDiscardedByDefaultLogging(sql)).toEqual([]);
  });
});

describe('_raisesDiscardedByDefaultLogging', () => {
  it('flags the levels stock log_min_messages throws away', () => {
    expect(_raisesDiscardedByDefaultLogging("DO $$ BEGIN RAISE NOTICE 'x'; END; $$;")).toEqual([
      'NOTICE',
    ]);
    expect(_raisesDiscardedByDefaultLogging("RAISE INFO 'x';")).toEqual(['INFO']);
    expect(_raisesDiscardedByDefaultLogging("RAISE DEBUG 'x';")).toEqual(['DEBUG']);
    expect(_raisesDiscardedByDefaultLogging("raise notice 'lowercase counts';")).toEqual([
      'NOTICE',
    ]);
  });

  it('passes the levels that land in the server log', () => {
    expect(_raisesDiscardedByDefaultLogging("RAISE WARNING 'x';")).toEqual([]);
    expect(_raisesDiscardedByDefaultLogging("RAISE LOG 'x';")).toEqual([]);
    expect(_raisesDiscardedByDefaultLogging("RAISE EXCEPTION 'x';")).toEqual([]);
    // Bare re-raise inside an EXCEPTION block.
    expect(_raisesDiscardedByDefaultLogging('RAISE;')).toEqual([]);
  });

  it('does not fire on prose explaining why NOTICE was rejected', () => {
    // The guard has to survive the comment the fix left behind, or the
    // next author deletes the comment to get CI green and loses the
    // reason. Both real forms are covered: a `--` line comment and a
    // block comment.
    expect(
      _raisesDiscardedByDefaultLogging(
        "-- RAISE NOTICE would be discarded here.\nRAISE WARNING 'x';",
      ),
    ).toEqual([]);
    expect(
      _raisesDiscardedByDefaultLogging("/* RAISE NOTICE is filtered */ RAISE WARNING 'x';"),
    ).toEqual([]);
  });
});
