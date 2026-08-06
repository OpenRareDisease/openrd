-- 023_patient_falls_down.sql
--
-- Reverse migration 023. Idempotent (IF EXISTS) so it can re-run
-- against a partially-applied or already-rolled-back state.
--
-- ROLL BACK THE API FIRST. THIS IS NOT A FALLS-ONLY OUTAGE.
--
-- The API that shipped with 023 reads patient_falls from inside the
-- followup retriever's EVENT query — the one query behind every
-- 「我最近怎么样」answer, not only the falls part of it. Drop this
-- table under a live new API and that query fails with 42P01
-- (undefined_table), which takes the whole followups retrieval down:
-- the patient asks about their stair-climb times and the model, having
-- received nothing, tells them they have no records. Stop the new API
-- or deploy the previous one BEFORE running this.
--
--
-- WHAT THIS DESTROYS, AND WHAT IT CANNOT PUT BACK
--
-- Dropping patient_falls destroys every structured fall detail
-- recorded since 023 went out: what the patient was doing, indoor or
-- outdoor, whether their hands were full, whether they could get up
-- unaided, whether they were hurt. None of it has a pre-023 home —
-- before this table the only place any of it could go was the free-text
-- `description` on the event row, and the diary never wrote there. The
-- only copy is the pre-migration pg_dump the deploy runbook mandates.
-- Take one FIRST, even in a rollback.
--
-- The DATES largely survive, and it is worth being precise about which
-- ones and why, because "the falls are still there" is exactly the kind
-- of half-truth this file exists to prevent:
--
--   * A fall recorded through the diary wrote a patient_followup_events
--     row in the same transaction (falls.service.ts). That row is NOT
--     touched here, so the fall itself — its date, and its place on the
--     病程时间线 — is still in the database after the rollback. Only
--     the five detail columns are gone.
--   * A fall back-filled by 023 came FROM an event row, which likewise
--     stays. Nothing is lost there at all.
--   * A row inserted into patient_falls by anything other than the
--     service — a support script, an import, a future code path that
--     forgets the twin — has no event behind it and disappears
--     completely. The DO block below counts exactly those and says so
--     out loud, because a rollback that reports success while silently
--     erasing a patient's fall history is worse than one that warns.
--
-- READ THE WARNING WHERE IT ACTUALLY LANDS. RAISE WARNING goes to the
-- POSTGRES SERVER log. It does NOT appear in the output of
-- `npm run db:migrate:down`: node-postgres delivers notices on the
-- connection's 'notice' event and apps/api/src/db/migrate.ts does not
-- subscribe to it, so the rollback prints one success line either way.
-- A quiet rollback is not evidence that nothing was lost. Migration
-- 022's down file carries the same warning about the same runner.

DO $$
DECLARE
  orphan_rows BIGINT;
BEGIN
  IF to_regclass('public.patient_falls') IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO orphan_rows
    FROM patient_falls
   WHERE deleted_at IS NULL
     AND origin_event_id IS NULL;

  IF orphan_rows > 0 THEN
    RAISE WARNING
      'patient_falls: % live row(s) have no patient_followup_events twin. Those falls exist ONLY in this table and are erased entirely by this rollback — date included, not just the detail columns. Restore them from the pre-rollback pg_dump.',
      orphan_rows;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Both indexes go with the table.
DROP TABLE IF EXISTS patient_falls;
