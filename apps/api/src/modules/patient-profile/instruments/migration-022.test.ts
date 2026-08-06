import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../../../../../db/migrations');
const forwardPath = path.join(migrationsDir, '022_patient_instruments.sql');
const downPath = path.join(migrationsDir, '022_patient_instruments_down.sql');

/**
 * Guards on migration 022's TEXT, in the same spirit as the 015
 * assertions in src/db/migrate.test.ts.
 *
 * WHY A TEST THAT READS SQL RATHER THAN RUNS IT: this suite has no live
 * Postgres — every service test in the repo drives a mocked pool — so
 * nothing here can observe the immutability trigger actually rejecting
 * an UPDATE. That is a real gap and it is stated plainly in the lane
 * report rather than papered over.
 *
 * What this file CAN do is make the load-bearing parts of the
 * migration hard to delete by accident. The immutability decision is
 * documented in three files as a guarantee; a comment asserting a
 * guarantee with nothing behind it is the exact failure mode this
 * codebase has been bitten by seven times. If someone removes the
 * trigger, these go red.
 */
describe('migration 022 — the immutability guarantee is actually in the SQL', () => {
  const sql = fs.readFileSync(forwardPath, 'utf8');

  it('installs a BEFORE UPDATE trigger on instrument_administrations', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER instrument_administrations_immutable\s+BEFORE UPDATE ON instrument_administrations/,
    );
  });

  it('installs the same trigger on instrument_item_responses', () => {
    // Item responses are what a re-scoring pass reads. An immutable
    // score over mutable answers is not immutable.
    expect(sql).toMatch(
      /CREATE TRIGGER instrument_item_responses_immutable\s+BEFORE UPDATE ON instrument_item_responses/,
    );
  });

  it('the trigger function raises rather than silently allowing the update', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION instrument_rows_are_immutable/);
    expect(sql).toMatch(/RAISE EXCEPTION/);
  });

  it('does NOT block DELETE — erasure has to stay reachable', () => {
    // PIPL Art. 47 outranks an audit trail about someone who has
    // withdrawn, and the account-deletion purge cascades through these
    // tables. A BEFORE DELETE trigger here would strand every account
    // that ever recorded a score.
    expect(sql).not.toMatch(/BEFORE DELETE ON instrument_administrations/);
    expect(sql).not.toMatch(/BEFORE DELETE ON instrument_item_responses/);
  });

  it('keeps the superseding chain linear with a unique index', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uniq_instrument_administrations_supersedes/,
    );
  });

  it('guards supersedes_id against pointing at another profile or another instrument', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION instrument_administrations_supersede_guard/);
    expect(sql).toMatch(/belongs to a different profile/);
  });

  it('seeds both instruments with a citation, not a bare name', () => {
    expect(sql).toContain('brooke_upper_extremity');
    expect(sql).toContain('vignos_lower_extremity');
    expect(sql).toContain('Muscle Nerve. 1981;4(3):186-97');
    expect(sql).toContain('JAMA. 1963;184:89-96');
    // The evidence that a patient may answer these at all.
    expect(sql).toContain('10.1186/s13023-021-01793-6');
  });
});

describe('migration 022 — the two enum gaps', () => {
  const sql = fs.readFileSync(forwardPath, 'utf8');

  it('admits face and abdominal on patient_measurements.muscle_group', () => {
    // The application-side half is MUSCLE_GROUPS in
    // profile.constants.ts. Editing one without the other leaves the
    // two disagreeing about what a valid row is; see the enum-gaps
    // test that pins them together.
    expect(sql).toMatch(/ADD CONSTRAINT patient_measurements_muscle_group_check/);
    expect(sql).toMatch(/'face'/);
    expect(sql).toMatch(/'abdominal'/);
  });

  it('reports how many rows the new muscle_group CHECK would reject', () => {
    // The constraint is added NOT VALID, so the deploy cannot fail on
    // legacy values — which means the deploy log is the only place an
    // operator learns whether any exist.
    expect(sql).toMatch(/NOT VALID/);
    expect(sql).toMatch(/RAISE WARNING/);
  });

  it('back-fills the ambulation boolean to the three-state value set', () => {
    expect(sql).toContain('"independent"');
    expect(sql).toContain('"assisted"');
    expect(sql).toMatch(/ADD CONSTRAINT patient_profiles_ambulation_state_check/);
    expect(sql).toMatch(/IN \('independent', 'assisted', 'unable'\)/);
  });

  it('does not reject profiles that have no baseline yet', () => {
    // baseline_payload is a free-form document written by several
    // screens. A constraint that required currentStatus to exist would
    // reject every account that has not finished onboarding.
    expect(sql).toMatch(/baseline_payload IS NULL/);
    expect(sql).toMatch(/NOT \(baseline_payload \? 'currentStatus'\)/);
  });
});

describe('migration 022 — the rollback tells the truth about what it loses', () => {
  const sql = fs.readFileSync(downPath, 'utf8');

  it('reverses the ambulation back-fill for the two legacy values', () => {
    expect(sql).toMatch(/'independent'/);
    expect(sql).toMatch(/'assisted', 'unable'/);
  });

  it('warns that rolling back collapses "unable" instead of silently succeeding', () => {
    // The 015 lesson: a rollback that reports success while destroying
    // a clinical distinction is worse than one that fails loudly.
    expect(sql).toMatch(/RAISE WARNING/);
    expect(sql).toMatch(/NOT recoverable from this database/);
  });

  it('drops the three tables in dependency order', () => {
    const responsesAt = sql.indexOf('DROP TABLE IF EXISTS instrument_item_responses');
    const administrationsAt = sql.indexOf('DROP TABLE IF EXISTS instrument_administrations');
    const catalogueAt = sql.indexOf('DROP TABLE IF EXISTS instruments;');
    expect(responsesAt).toBeGreaterThan(-1);
    expect(responsesAt).toBeLessThan(administrationsAt);
    expect(administrationsAt).toBeLessThan(catalogueAt);
  });
});
