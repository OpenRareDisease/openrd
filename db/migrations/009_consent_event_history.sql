-- 009_consent_event_history.sql
-- Persistent grant/revoke history for each AI consent flag. The
-- per-flag `_at` columns on `patient_profiles` (added in
-- 008_ai_consent_and_audit.sql) only show the most recent
-- transition for each flag, so a user who toggles a flag off and
-- back on loses the record that they had revoked it in between.
-- Compliance / support frequently want to prove the full timeline:
-- "did this user consent to precise values during the week of X?",
-- "did they revoke before we ingested their data?", etc.
--
-- One row per flag transition. Flag name is stored as text (rather
-- than three boolean columns) so adding a new consent flag in the
-- future is a write-side change only -- the table doesn't need a
-- migration. `source` records who/what triggered the change
-- (`user` for self-service via the mobile UI, `admin` for support
-- overrides, `system` for coercion -- e.g. forcing precise=false
-- when personal is revoked).
--
-- Closes issue #22.

CREATE TABLE IF NOT EXISTS ai_consent_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  flag_name    TEXT NOT NULL CHECK (flag_name IN ('personal', 'third_party', 'precise_values')),
  from_value   BOOLEAN NOT NULL,
  to_value     BOOLEAN NOT NULL,
  -- Where the transition came from. The orchestrator + mobile UI
  -- write 'user'; admin tools (future) write 'admin'; the security
  -- helper writes 'system' when it coerces precise->false because
  -- the base pair dropped.
  source       TEXT NOT NULL DEFAULT 'user'
               CHECK (source IN ('user', 'admin', 'system')),
  -- Optional free-text note for support ("user phoned in to opt
  -- out", "automated rollout of new consent terms", etc.). Never
  -- contains PII; safe to surface in the future audit viewer.
  note         TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Newest-first listing per user is the dominant query (the future
-- "consent history" viewer + compliance look-ups). A partial index
-- on flag_name would be premature -- users typically have well
-- under 100 events total, so a single composite index is fine.
CREATE INDEX IF NOT EXISTS ai_consent_events_user_changed_idx
  ON ai_consent_events (user_id, changed_at DESC);
