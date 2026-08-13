-- Puts idx_patient_measurements_cohort back to 018's definition.
--
-- Carry its `SET lock_timeout = '2s'` across unchanged, and read the
-- hatch for what it is: shorter, not lock-free. The swap transaction
-- opens with the same DROP INDEX, so it too takes ACCESS EXCLUSIVE on
-- patient_measurements and holds it until COMMIT, and reads stop for it
-- just as they stop for the CREATE below — measured on dev at DROP
-- 1.5 ms + RENAME 0.3 ms, against this file's DROP plus a full build.
-- Rolling back the index alone does not roll back the query, so the
-- cohort distribution keeps working and keeps being correct — it just
-- loses the index-only plan and goes back to a heap scan plus a sort.
-- Recreating 018's shape rather than leaving the index dropped is the
-- safer end state: muscle_group still has a leading-column index, which
-- is the sequential scan 018 existed to prevent.
--
-- Same lock as the forward file, for the same reason: this runs inside
-- one runner-owned transaction, so the DROP's ACCESS EXCLUSIVE on
-- patient_measurements is still held while the CREATE builds. Reads as
-- well as writes stop for the length of the build — measured on dev's
-- 233 rows at DROP 0.9 ms + CREATE 5.6 ms.
--
-- The forward file's escape hatch works here too, with two changes:
-- build the v2 index CONCURRENTLY with 018's column list
-- `(muscle_group, strength_score)`, and in the swap transaction DELETE
-- the 025 row from schema_migrations instead of inserting it — that is
-- the half `--down` would otherwise do, and the half that decides
-- whether the next roll-forward runs this file again.
--

DROP INDEX IF EXISTS idx_patient_measurements_cohort;

CREATE INDEX IF NOT EXISTS idx_patient_measurements_cohort
  ON patient_measurements (muscle_group, strength_score);
