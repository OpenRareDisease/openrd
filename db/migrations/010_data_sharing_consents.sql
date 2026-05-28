-- 010_data_sharing_consents.sql
-- Persist the four data-sharing toggles that the mobile privacy
-- settings screen used to keep in `useState` only:
--
--   - clinical trial data authorisation
--   - anonymous data donation
--   - hospital HIS sync
--   - community-sharing of recovery posts / videos
--
-- Previously a fresh install + toggle would silently lose the user's
-- preference because nothing was persisted server-side; the screen
-- just rendered hard-coded defaults. The columns mirror the layout
-- of `ai_consent_*` from migration 008 (boolean + matching `_at`
-- timestamp) so the UI can show a "上次更新 …" hint per toggle.
--
-- A future generalised `privacy_events` table could give these four
-- toggles a full grant/revoke timeline (similar to
-- `ai_consent_events` from migration 009), but that's deferred until
-- product confirms which of these toggles need that level of audit.
-- For now the `_at` columns retain only the most recent transition
-- — same simplification we accepted for AI consent before #22.

ALTER TABLE patient_profiles
  ADD COLUMN IF NOT EXISTS clinical_trial_consent      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clinical_trial_consent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_donation_consent       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_donation_consent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hospital_sync_consent       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hospital_sync_consent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS community_share_consent     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS community_share_consent_at  TIMESTAMPTZ;
