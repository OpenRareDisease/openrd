import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AMBULATION_STATES, FOLLOWUP_EVENT_TYPES, MUSCLE_GROUPS } from '../profile.constants.js';
import { baselineProfileSchema, measurementSchema } from '../profile.schema.js';
import { ambulationStateFromVignosGrade } from './vignos.js';

/**
 * The two enum gaps, and the two-place-edit discipline that keeps them
 * from drifting.
 *
 * This file lives under instruments/ rather than beside
 * profile.schema.ts because the two gaps are not incidental to the
 * instrument work: `AMBULATION_STATES` exists so a Vignos grade has
 * somewhere to land, and `face` / `abdominal` exist because two of the
 * six regions of the FSHD Clinical Score were unrecordable. Testing
 * the constant, the Zod schema and the migration CHECK together is the
 * point — each on its own can be widened while the others silently
 * disagree about what a valid row is.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migration022 = fs.readFileSync(
  path.resolve(__dirname, '../../../../../../db/migrations/022_patient_instruments.sql'),
  'utf8',
);

describe('MUSCLE_GROUPS', () => {
  it('can record the face — the "facio" in facioscapulohumeral', () => {
    expect(MUSCLE_GROUPS).toContain('face');
  });

  it('can record the abdominal wall — the region Beevor’s sign tests', () => {
    expect(MUSCLE_GROUPS).toContain('abdominal');
  });

  it('accepts a facial measurement through the write schema', () => {
    const parsed = measurementSchema.parse({ muscleGroup: 'face', strengthScore: 3 });
    expect(parsed.muscleGroup).toBe('face');
  });

  it('still rejects a muscle group nobody defined', () => {
    expect(() => measurementSchema.parse({ muscleGroup: 'jaw', strengthScore: 3 })).toThrow();
  });

  it('agrees exactly with the CHECK constraint in migration 022', () => {
    // The two-place edit, enforced. Widening the constant without
    // widening the migration produces rows the API accepts and the
    // database refuses; widening the migration alone produces values
    // the database allows and no screen can render.
    const match = migration022.match(
      /ADD CONSTRAINT patient_measurements_muscle_group_check\s+CHECK \(muscle_group IN \(([^)]*)\)\)/,
    );
    expect(match).not.toBeNull();
    const inMigration = (match?.[1] ?? '')
      .split(',')
      .map((value) => value.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    expect(inMigration.slice().sort()).toEqual(MUSCLE_GROUPS.slice().sort());
  });
});

describe('AMBULATION_STATES', () => {
  it('can express 「需辅助行走」 as its own state', () => {
    expect(AMBULATION_STATES).toEqual(['independent', 'assisted', 'unable']);
  });

  it('has a state for the event started_wheelchair announces', () => {
    // Before 'unable' existed the event could be logged and the state
    // it transitions into could not be recorded, so the timeline and
    // the profile disagreed by construction.
    expect(FOLLOWUP_EVENT_TYPES).toContain('started_wheelchair');
    expect(ambulationStateFromVignosGrade(9)).toBe('unable');
    expect(AMBULATION_STATES).toContain('unable');
  });

  it('agrees exactly with the CHECK constraint in migration 022', () => {
    const match = migration022.match(
      /baseline_payload #>> '\{currentStatus,independentlyAmbulatory\}'\s+IN \(([^)]*)\)/,
    );
    expect(match).not.toBeNull();
    const inMigration = (match?.[1] ?? '')
      .split(',')
      .map((value) => value.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    expect(inMigration.slice().sort()).toEqual(AMBULATION_STATES.slice().sort());
  });
});

describe('baselineProfileSchema — currentStatus.independentlyAmbulatory', () => {
  const parseState = (value: unknown) =>
    baselineProfileSchema.parse({ currentStatus: { independentlyAmbulatory: value } }).currentStatus
      ?.independentlyAmbulatory;

  it.each(AMBULATION_STATES)('accepts %s', (state) => {
    expect(parseState(state)).toBe(state);
  });

  it('rejects a state nobody defined', () => {
    expect(() => parseState('wheelchair')).toThrow();
  });

  it('still accepts true from a cached client and normalises it to independent', () => {
    // The app ships as a web export opened inside WeChat's in-app
    // browser, which caches aggressively. Rejecting the old shape
    // would 400 the registration form — the one screen a new patient
    // cannot get past.
    expect(parseState(true)).toBe('independent');
  });

  it('normalises false to assisted — the label the patient actually tapped', () => {
    // NOT to 'unable'. An old client has no way to say 'unable', so
    // reading anything more into `false` than the button it came from
    // would be the app inventing a clinical fact.
    expect(parseState(false)).toBe('assisted');
  });

  it('leaves null and undefined alone', () => {
    expect(parseState(null)).toBeNull();
    expect(
      baselineProfileSchema.parse({ currentStatus: {} }).currentStatus?.independentlyAmbulatory,
    ).toBeUndefined();
  });
});
