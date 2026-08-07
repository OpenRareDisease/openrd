import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFallSchema } from './falls.schema.js';
import { FALL_ACTIVITIES, FALL_LOCATIONS } from '../profile.constants.js';

/**
 * Guards on migration 023's TEXT, in the same spirit as the 022
 * assertions next door.
 *
 * WHY A TEST THAT READS SQL RATHER THAN RUNS IT: this suite has no live
 * Postgres — every service test in the repo drives a mocked pool — so
 * nothing here can observe a CHECK constraint actually rejecting a
 * write, and nothing here can observe the back-fill running. That is a
 * real gap and it is stated plainly in the lane report rather than
 * papered over.
 *
 * What this file CAN do is keep the load-bearing parts of the migration
 * from being edited away, and keep the two-place enum edit honest.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../../../../../db/migrations');
const forward = fs.readFileSync(path.join(migrationsDir, '023_patient_falls.sql'), 'utf8');
const down = fs.readFileSync(path.join(migrationsDir, '023_patient_falls_down.sql'), 'utf8');

const checkValues = (sql: string, column: string): string[] => {
  const match = sql.match(
    new RegExp(`${column}\\s+TEXT\\s*\\n?\\s*CHECK \\(${column} IN \\(([^)]*)\\)\\)`),
  );
  expect(match).not.toBeNull();
  return (match?.[1] ?? '')
    .split(',')
    .map((value) => value.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
};

describe('migration 023 — the structure the AI can actually read', () => {
  it('gives every detail its own column instead of one blob', () => {
    // The entire reason this table exists: the retriever's allowlist
    // refuses patient-typed columns, so a fall in prose reached the
    // database and reached nothing else.
    for (const column of [
      'occurred_on',
      'activity',
      'location',
      'hands_full',
      'got_up_unaided',
      'injured',
    ]) {
      expect(forward).toContain(column);
    }
    // No column of any name may be a blob. (The word appears in the
    // file's header, which is why this matches a column declaration
    // rather than the string.)
    expect(forward).not.toMatch(/^\s+\w+\s+JSONB/m);
  });

  it('requires the date and nothing else', () => {
    // A fall is recorded by someone who has just been on the floor. If
    // saving costs six answers, the fall does not get recorded.
    expect(forward).toMatch(/occurred_on\s+DATE NOT NULL/);
    for (const column of ['activity', 'location', 'hands_full', 'got_up_unaided', 'injured']) {
      expect(forward).not.toMatch(new RegExp(`${column}\\s+(TEXT|BOOLEAN) NOT NULL`));
    }
  });

  it('keeps the date a DATE so it cannot drift across a timezone', () => {
    expect(forward).not.toMatch(/occurred_on\s+TIMESTAMPTZ/);
  });

  it('soft-deletes, like every other record a patient hand-enters', () => {
    // Migration 016's argument, plus one specific to this form: it is a
    // one-tap control for people with impaired fine motor control, so
    // mis-taps are expected rather than exceptional.
    expect(forward).toMatch(/deleted_at\s+TIMESTAMPTZ/);
    expect(forward).toMatch(/idx_patient_falls_profile_live[\s\S]*WHERE deleted_at IS NULL/);
  });

  it('enforces one diary entry per followup event', () => {
    // The de-duplication in FALL_HISTORY_SQL is a NOT EXISTS against
    // this column. If two rows could mirror one event, that dedupe
    // would hide a real fall — and it would hide it in the direction
    // that reassures the patient.
    expect(forward).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uniq_patient_falls_origin_event[\s\S]*WHERE origin_event_id IS NOT NULL/,
    );
  });

  it('back-fills the falls a patient already logged, with no invented detail', () => {
    // Without this, someone who has been logging falls for a year opens
    // the new diary to an empty screen.
    expect(forward).toMatch(
      /INSERT INTO patient_falls \(profile_id, occurred_on, origin_event_id, created_at\)/,
    );
    expect(forward).toContain("fe.event_type = 'fall'");
    // Retracted events stay retracted: copying one into a new table
    // would resurrect it where the patient cannot see it.
    expect(forward).toContain('fe.deleted_at IS NULL');
    // The date is converted in the patient's timezone, not the
    // server's — a bare ::date moves every fall logged after 20:00
    // Beijing to the previous day.
    expect(forward).toContain("AT TIME ZONE 'Asia/Shanghai'");
  });

  it('is re-runnable without duplicating the back-fill', () => {
    expect(forward).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM patient_falls existing/);
  });
});

describe('migration 023 down', () => {
  it('warns about the rows it erases completely instead of reporting success', () => {
    expect(down).toContain('RAISE WARNING');
    expect(down).toContain('origin_event_id IS NULL');
  });

  it('says the warning does not reach the migrate runner', () => {
    // Verified for 022 and unchanged: node-postgres delivers notices on
    // the connection's 'notice' event and migrate.ts does not subscribe.
    expect(down).toContain('POSTGRES SERVER log');
  });

  it('states that rolling back under the new API breaks more than falls', () => {
    // patient_falls is read from inside the followup retriever's EVENT
    // query, so 42P01 takes the whole 「我最近怎么样」 path down.
    expect(down).toContain('42P01');
  });
});

describe('the two-place enum edit', () => {
  it('FALL_ACTIVITIES agrees exactly with the CHECK constraint', () => {
    // Widening the constant alone produces rows the API accepts and the
    // database refuses; widening the migration alone produces values no
    // screen can render.
    expect(checkValues(forward, 'activity').slice().sort()).toEqual(FALL_ACTIVITIES.slice().sort());
  });

  it('FALL_LOCATIONS agrees exactly with the CHECK constraint', () => {
    expect(checkValues(forward, 'location').slice().sort()).toEqual(FALL_LOCATIONS.slice().sort());
  });

  it('keeps 「记不清」 as a value rather than folding it into NULL', () => {
    // Migration 017 had to add a whole column to recover this
    // distinction after NULL was made to carry two facts.
    expect(FALL_ACTIVITIES).toContain('unknown');
    expect(FALL_LOCATIONS).toContain('unknown');
  });

  it('rejects a value nobody defined', () => {
    expect(() =>
      createFallSchema.parse({ occurredOn: '2026-08-01', activity: 'gardening' }),
    ).toThrow();
    expect(() =>
      createFallSchema.parse({ occurredOn: '2026-08-01', location: 'balcony' }),
    ).toThrow();
  });
});

describe('createFallSchema', () => {
  it('saves on the date alone', () => {
    expect(createFallSchema.parse({ occurredOn: '2026-08-01' }).occurredOn).toBe('2026-08-01');
  });

  it('refuses a date the calendar does not have', () => {
    // Date.parse accepts 2026-02-31 and silently rolls it to March 3rd,
    // which files a fall in the wrong month forever.
    expect(() => createFallSchema.parse({ occurredOn: '2026-02-31' })).toThrow();
  });

  it('refuses a fat-fingered year', () => {
    expect(() => createFallSchema.parse({ occurredOn: '2088-01-01' })).toThrow();
  });

  /**
   * The clock is pinned for the two assertions below, and the dates are
   * literals rather than arithmetic on `Date.now()`.
   *
   * The version this replaces derived its 「tomorrow」 from
   * `Date.now() + 12h` rendered as a UTC date, so between 00:00 and
   * 11:59 UTC that string was TODAY: for half of every day the test
   * named 「tolerates one day ahead」 asserted nothing about the
   * tolerance, and a refine tightened to `<= Date.now()` passed. Both
   * instants below are on opposite sides of noon UTC for that reason —
   * the bound has to hold at every hour, not at the convenient ones.
   */
  const HOURS_EITHER_SIDE_OF_NOON_UTC = ['2026-08-06T03:00:00Z', '2026-08-06T23:00:00Z'];

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tolerates one day ahead, because the server clock is not the patient’s', () => {
    vi.useFakeTimers();
    for (const instant of HOURS_EITHER_SIDE_OF_NOON_UTC) {
      vi.setSystemTime(new Date(instant));
      expect(() => createFallSchema.parse({ occurredOn: '2026-08-07' })).not.toThrow();
    }
  });

  it('refuses the day after that, so the tolerance stays one day wide', () => {
    // The upper edge was unpinned in either direction: 2088-01-01 is 62
    // years out, so a refine widened to +72h — a date-picker bug filing
    // a fall three days from now — shipped green.
    vi.useFakeTimers();
    for (const instant of HOURS_EITHER_SIDE_OF_NOON_UTC) {
      vi.setSystemTime(new Date(instant));
      expect(() => createFallSchema.parse({ occurredOn: '2026-08-08' })).toThrow(
        '跌倒日期不能晚于今天',
      );
    }
  });

  it('has no free-text field, and must not grow one', () => {
    // A `notes` field would recreate exactly the problem this migration
    // was written to solve, and it would recreate it invisibly, because
    // the field would still save.
    const parsed = createFallSchema.parse({
      occurredOn: '2026-08-01',
      // @ts-expect-error — proving the schema strips what it does not know
      notes: '在厨房差点摔了',
    });
    expect(JSON.stringify(parsed)).not.toContain('厨房');
  });
});
