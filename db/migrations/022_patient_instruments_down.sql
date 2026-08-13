-- 022_patient_instruments_down.sql
--
-- Reverse migration 022 in a hot rollback. Idempotent (IF EXISTS /
-- IF NOT EXISTS) so it can re-run against a partially-applied or
-- already-rolled-back state.
--
-- WHAT THIS DESTROYS, AND WHAT IT CANNOT PUT BACK
-- ---------------------------------------------------------------
-- Dropping the three instrument tables destroys every score recorded
-- since 022 went out. There is no legacy column to restore them from,
-- because before 022 there was nowhere to put them — a Brooke grade
-- has no pre-022 home. The only copy is the pre-migration pg_dump the
-- deploy runbook mandates. Run this only if you are prepared to lose
-- the interval, and take a dump FIRST even in a rollback.
--
-- The ambulation back-fill is the more subtle loss. 022 mapped
-- true -> 'independent' and false -> 'assisted'. Those two are
-- reversed here exactly. 'unable' is NOT reversible: the boolean it
-- would have to become is `false`, which is the same value 'assisted'
-- reverses to, and 'unable' exists precisely because that collapse was
-- destroying information. A patient who told us after 022 that they
-- cannot walk goes back to being indistinguishable from a patient who
-- walks with a cane. The DO block below counts them and says so out
-- loud rather than silently succeeding, because a rollback that
-- reports success while flattening a clinical distinction is worse
-- than one that warns.
--
-- READ THE WARNING WHERE IT ACTUALLY LANDS. RAISE WARNING goes to the
-- POSTGRES SERVER log (verified against PG 18). It does NOT appear in
-- the output of `npm run db:migrate:down`: node-postgres delivers
-- notices on the connection's 'notice' event and
-- apps/api/src/db/migrate.ts does not subscribe to it, so the rollback
-- prints one success line either way. A quiet rollback is not
-- evidence that nothing was lost.

-- ---------------------------------------------------------------- ambulation

ALTER TABLE patient_profiles
  DROP CONSTRAINT IF EXISTS patient_profiles_ambulation_state_check;

DO $$
DECLARE
  unable_rows BIGINT;
BEGIN
  SELECT count(*) INTO unable_rows
    FROM patient_profiles
   WHERE baseline_payload #>> '{currentStatus,independentlyAmbulatory}' = 'unable';

  IF unable_rows > 0 THEN
    RAISE WARNING
      'patient_profiles: % profile(s) recorded independentlyAmbulatory = ''unable''. Rolling back collapses them to the boolean false, which is indistinguishable from ''assisted''. The distinction is NOT recoverable from this database; restore it from the pre-rollback pg_dump.',
      unable_rows;
  END IF;
END;
$$ LANGUAGE plpgsql;

UPDATE patient_profiles
   SET baseline_payload = jsonb_set(
         baseline_payload,
         '{currentStatus,independentlyAmbulatory}',
         'true'::jsonb
       )
 WHERE baseline_payload #>> '{currentStatus,independentlyAmbulatory}' = 'independent';

UPDATE patient_profiles
   SET baseline_payload = jsonb_set(
         baseline_payload,
         '{currentStatus,independentlyAmbulatory}',
         'false'::jsonb
       )
 WHERE baseline_payload #>> '{currentStatus,independentlyAmbulatory}' IN ('assisted', 'unable');

-- ---------------------------------------------------------------- muscle groups
--
-- Only the constraint is dropped. 022 wrote no muscle_group values and
-- destroyed none, so there is nothing to restore; rows carrying 'face'
-- or 'abdominal' written while 022 was live stay exactly as they are.
-- They will fail the application-layer Zod enum once the code is
-- rolled back with the schema, which surfaces as a validation error on
-- a read path rather than a corrupted number.

ALTER TABLE patient_measurements
  DROP CONSTRAINT IF EXISTS patient_measurements_muscle_group_check;

-- ---------------------------------------------------------------- instruments
--
-- Order matters: item responses reference administrations, and
-- administrations reference themselves (supersedes_id) and the
-- catalogue. DROP TABLE takes the dependent constraints with it, but
-- dropping in dependency order keeps the intent readable and keeps a
-- partial rollback from stalling on a FK.

DROP TRIGGER IF EXISTS instrument_item_responses_immutable ON instrument_item_responses;
DROP TRIGGER IF EXISTS instrument_administrations_immutable ON instrument_administrations;
DROP TRIGGER IF EXISTS instrument_administrations_supersede ON instrument_administrations;

DROP TABLE IF EXISTS instrument_item_responses;
DROP TABLE IF EXISTS instrument_administrations;
DROP TABLE IF EXISTS instruments;

DROP FUNCTION IF EXISTS instrument_rows_are_immutable();
DROP FUNCTION IF EXISTS instrument_administrations_supersede_guard();
