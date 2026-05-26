-- 008_ai_consent_and_audit.sql
-- Adds the three-tier consent model to patient_profiles and creates the
-- ai_prompt_audit table that records every LLM call.
-- See docs/proposals/local-rag-migration.md §5 (consent) and §7 (audit).

-- Three independent consent flags. All default to FALSE; the user must
-- explicitly opt in. Each flag carries an "_at" timestamp so we can
-- prove when consent was given (or revoked, when reset to FALSE).
ALTER TABLE patient_profiles
  ADD COLUMN IF NOT EXISTS ai_consent_personal           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_consent_personal_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_consent_third_party        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_consent_third_party_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_consent_precise_values     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_consent_precise_values_at  TIMESTAMPTZ;

-- Audit table: one row per /api/ai/ask invocation.
-- We never store the prompt body, only a hash + length + the field names
-- that were used. This gives full traceability without becoming a
-- secondary data leak channel.
CREATE TABLE IF NOT EXISTS ai_prompt_audit (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID REFERENCES app_users(id) ON DELETE SET NULL,
  -- Request correlation. request_id mirrors any client-supplied progress
  -- id so support tickets can be cross-referenced.
  request_id            TEXT,
  -- LLM context.
  llm_provider          TEXT NOT NULL,
  llm_model             TEXT NOT NULL,
  -- Consent + redaction state at the time of the call.
  consent_level         TEXT NOT NULL,        -- 'none' | 'basic' | 'precise'
  redaction_mode        TEXT NOT NULL,        -- 'strict' | 'precise'
  -- Prompt accounting (hash only, never the full text).
  redacted_prompt_hash  TEXT,
  prompt_char_length    INTEGER,
  -- Which patient-scoped fields actually made it into the prompt this
  -- call, and which tools were invoked.
  used_personal_data    BOOLEAN NOT NULL DEFAULT FALSE,
  fields_used           JSONB NOT NULL DEFAULT '[]'::jsonb,
  tools_called          JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Outcome bookkeeping.
  latency_ms            INTEGER,
  status                TEXT NOT NULL,        -- 'success' | 'error' | 'consent_denied'
  error_detail          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_prompt_audit_user_created_idx
  ON ai_prompt_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_prompt_audit_redaction_mode_idx
  ON ai_prompt_audit (redaction_mode);
CREATE INDEX IF NOT EXISTS ai_prompt_audit_status_idx
  ON ai_prompt_audit (status);
-- Support tickets and incident triage routinely look up an audit row
-- by the originating request_id. Partial index keeps the size small
-- because most rows do carry one, but we don't want NULLs in the index.
CREATE INDEX IF NOT EXISTS ai_prompt_audit_request_id_idx
  ON ai_prompt_audit (request_id)
  WHERE request_id IS NOT NULL;
