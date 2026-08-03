-- Rollback for 019_legal_document_acceptances.sql.
--
-- WARNING: this drops the only record that any user ever accepted any
-- version of the 用户协议 / 隐私政策 / 敏感个人信息单独同意. Unlike a
-- column drop, there is nothing left to reconstruct it from — the
-- acceptance exists nowhere else in the schema.
--
-- Before running this against a database that has served real users,
-- dump the table first:
--
--   pg_dump "$PROD_DB" -t legal_document_acceptances --data-only \
--     > legal_acceptances_$(date +%F).sql
--
-- The API module reads this table to decide whether the sensitive-PI
-- consent gate has been satisfied, so with the table gone every user is
-- asked for 单独同意 again on their next report upload. That is the
-- safe direction to fail (ask again rather than assume consent), but it
-- is a visible regression for existing users — roll the API back with
-- the schema.
DROP INDEX IF EXISTS idx_legal_acceptances_user_document_time;
DROP INDEX IF EXISTS uniq_legal_acceptance_user_document_version;

DROP TABLE IF EXISTS legal_document_acceptances;
