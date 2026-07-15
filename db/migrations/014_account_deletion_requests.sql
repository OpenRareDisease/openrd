-- Account deletion with a cooling-off period (删除权 / right to
-- erasure). A deletion request parks the account for
-- ACCOUNT_DELETION_COOLING_DAYS (7, enforced in code); the user can
-- cancel any time before scheduled_purge_at. A sweep then purges the
-- user row (app_users cascades to patient_profiles and every
-- patient_* table) plus the legacy chat tables whose FKs predate
-- ON DELETE clauses.
--
-- Deliberately NO foreign key on user_id: this table is the
-- compliance ledger proving the deletion happened, so its rows must
-- survive the very DELETE they describe. ai_prompt_audit keeps its
-- own rows via ON DELETE SET NULL for the same reason.
CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL,
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_purge_at  TIMESTAMPTZ NOT NULL,
    cancelled_at        TIMESTAMPTZ,
    purged_at           TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'cancelled', 'purged')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live request per user; cancelled/purged history rows stack up
-- freely underneath.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deletion_requests_pending
    ON account_deletion_requests (user_id)
    WHERE status = 'pending';

-- The purge sweep scans by due time.
CREATE INDEX IF NOT EXISTS idx_deletion_requests_due
    ON account_deletion_requests (scheduled_purge_at)
    WHERE status = 'pending';
