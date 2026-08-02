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
--
-- Lock note (the one 018 has and this file did not)
-- ---------------------------------------------------------------
-- The seven UPDATEs below take ROW EXCLUSIVE and the ADD CONSTRAINT at
-- the bottom takes ACCESS EXCLUSIVE with a validating scan, all inside
-- the single transaction migrate.ts wraps this file in. At the dataset
-- this was written for — 018 measured 233 rows in the sibling
-- patient_measurements table — that is milliseconds, and the deploy
-- shape has no concurrent writer anyway (one `api:` service, no
-- `deploy.replicas`, so the old container is stopped before the new
-- one migrates). If patient_function_tests ever reaches six figures,
-- split this into a back-fill migration and a separate
-- ADD CONSTRAINT … NOT VALID + scheduled VALIDATE CONSTRAINT — but
-- read the NOT VALID reasoning above first, because it is why the
-- constraint is validated here rather than deferred.

-- Preserve what the patient actually typed, before anything is mapped.
-- ---------------------------------------------------------------
-- The last UPDATE in this file NULLs every unit the alias table does
-- not recognise. That is patient-entered text, this migration has
-- never run against production (`git ls-tree v2.4.0 db/migrations/`
-- stops at 012), and until this column existed the `_down.sql` next to
-- this file was making a promise it could not keep: it can drop the
-- CHECK constraint, but nothing brought the destroyed text back.
--
-- unit_legacy is a recovery record, not a live column. Nothing reads
-- it, nothing writes it after this migration, and it is deliberately
-- outside the CHECK below so it can hold whatever arbitrary string was
-- there. Drop it in a later migration only once someone has run
--   SELECT unit_legacy, count(*) FROM patient_function_tests
--    WHERE unit IS NULL AND unit_legacy IS NOT NULL GROUP BY 1;
-- against production and decided the survivors are not worth keeping.
ALTER TABLE patient_function_tests
  ADD COLUMN IF NOT EXISTS unit_legacy TEXT;

-- `unit_legacy IS NULL` guard, not a bare copy: this file has to stay
-- re-runnable, and a second pass must not overwrite the original text
-- with the canonicalised value the first pass already wrote to `unit`.
UPDATE patient_function_tests
  SET unit_legacy = unit
  WHERE unit IS NOT NULL AND unit_legacy IS NULL;

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
-- editable and retractable. The original survives in unit_legacy, which
-- is what makes the _down script's restore real rather than aspirational.
UPDATE patient_function_tests SET unit = NULL
  WHERE unit IS NOT NULL
    AND unit NOT IN ('sec', 'm', 'm/s', 'reps', 'kg', 'score');

ALTER TABLE patient_function_tests
  ADD CONSTRAINT patient_function_tests_unit_check
  CHECK (unit IS NULL OR unit IN ('sec', 'm', 'm/s', 'reps', 'kg', 'score'));
