-- Rollback for 020_legal_acceptance_withdrawal.sql.
--
-- WARNING: dropping `withdrawn_at` does not restore the state before a
-- withdrawal — it ERASES the fact that one happened, and every read
-- that filtered on `withdrawn_at IS NULL` starts counting withdrawn
-- consents as live again. A user who revoked their consent to
-- sensitive-data processing would silently be treated as consenting.
--
-- Before running this on data that has been live, export the withdrawn
-- rows:
--
--   \copy (SELECT user_id, document, version, accepted_at, withdrawn_at
--            FROM legal_document_acceptances
--           WHERE withdrawn_at IS NOT NULL)
--     TO 'withdrawals.csv' CSV HEADER
--
-- and decide what should happen to those users before the column goes.

DROP INDEX IF EXISTS idx_legal_acceptances_live;

ALTER TABLE legal_document_acceptances
  DROP COLUMN IF EXISTS withdrawn_at;
