-- 015_function_test_unit_constraint.sql
--
-- `patient_function_tests.unit` was the last patient-writable TEXT
-- column on the followup path with no value set at all: TEXT in SQL,
-- `z.string().max(32)` in Zod. Its two siblings on the same row —
-- `test_type` and `side` — are both enum-constrained (012 added the
-- test_type CHECK), and the AI followup retriever hands `unit` to the
-- model, so an unconstrained column here meant the one field on that
-- path whose contents nothing could vouch for.
--
-- Value set mirrors FUNCTION_TEST_UNITS in profile.schema.ts. Keep the
-- two in sync: the Zod enum is what rejects a bad write, this CHECK is
-- the guard rail for the paths Zod never sees (a direct SQL UPDATE, a
-- future import pipeline, a support tool).
--
-- Why this back-fills and validates rather than following 012's
-- NOT VALID convention
-- ---------------------------------------------------------------
-- NOT VALID only skips the scan when the constraint is *added*. Every
-- later UPDATE still re-checks the whole new tuple, whichever column
-- it touched. Migration 016, in this same batch, introduces soft
-- delete, and retraction is written as
--
--   UPDATE patient_function_tests SET deleted_at = NOW() WHERE ...
--
-- so a NOT VALID constraint here would make exactly the wrong rows
-- undeletable: any row still holding a pre-enum unit would raise 23514
-- on retraction. The rows most likely to hold free-text units are the
-- old ones — and old rows are what retraction is for. 016's own
-- worked example is a patient undoing a stair climb they mistyped as
-- 185 seconds months ago.
--
-- So the legacy values are mapped here, using the same table the
-- retriever defends itself with (UNIT_ALIASES in
-- patient-followups.ts). Anything still unrecognised becomes NULL: the
-- column is nullable, a missing unit degrades how a measurement is
-- displayed rather than the measurement itself, and the alternative is
-- a row the patient can never retract.

BEGIN;

-- Known aliases → canonical form. Mirrors UNIT_ALIASES.
UPDATE patient_function_tests SET unit = 'sec'
  WHERE unit IS NOT NULL AND lower(btrim(unit)) IN ('sec', 's', '秒');
UPDATE patient_function_tests SET unit = 'm'
  WHERE unit IS NOT NULL AND lower(btrim(unit)) IN ('m', '米');
UPDATE patient_function_tests SET unit = 'm/s'
  WHERE unit IS NOT NULL AND lower(btrim(unit)) = 'm/s';
UPDATE patient_function_tests SET unit = 'reps'
  WHERE unit IS NOT NULL AND lower(btrim(unit)) IN ('reps', '次');
UPDATE patient_function_tests SET unit = 'kg'
  WHERE unit IS NOT NULL AND lower(btrim(unit)) = 'kg';
UPDATE patient_function_tests SET unit = 'score'
  WHERE unit IS NOT NULL AND lower(btrim(unit)) = 'score';

-- Anything left is text nobody can vouch for. NULL it so the row stays
-- editable and retractable.
UPDATE patient_function_tests SET unit = NULL
  WHERE unit IS NOT NULL
    AND unit NOT IN ('sec', 'm', 'm/s', 'reps', 'kg', 'score');

ALTER TABLE patient_function_tests
  ADD CONSTRAINT patient_function_tests_unit_check
  CHECK (unit IS NULL OR unit IN ('sec', 'm', 'm/s', 'reps', 'kg', 'score'));

COMMIT;
