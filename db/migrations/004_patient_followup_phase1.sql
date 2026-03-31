ALTER TABLE patient_profiles
  ADD COLUMN IF NOT EXISTS baseline_payload JSONB;

ALTER TABLE patient_submissions
  ADD COLUMN IF NOT EXISTS submission_kind TEXT NOT NULL DEFAULT 'followup',
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS changed_since_last BOOLEAN;

ALTER TABLE patient_measurements
  ADD COLUMN IF NOT EXISTS metric_key TEXT,
  ADD COLUMN IF NOT EXISTS body_region TEXT,
  ADD COLUMN IF NOT EXISTS side TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS entry_mode TEXT NOT NULL DEFAULT 'self_report',
  ADD COLUMN IF NOT EXISTS device_used TEXT;

ALTER TABLE patient_function_tests
  ADD COLUMN IF NOT EXISTS submission_id UUID REFERENCES patient_submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS side TEXT,
  ADD COLUMN IF NOT EXISTS protocol TEXT,
  ADD COLUMN IF NOT EXISTS device_used TEXT,
  ADD COLUMN IF NOT EXISTS assistance_required BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_patient_measurements_metric_side
  ON patient_measurements (profile_id, COALESCE(metric_key, muscle_group), side, recorded_at DESC);

CREATE TABLE IF NOT EXISTS patient_symptom_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES patient_submissions(id) ON DELETE SET NULL,
  symptom_key TEXT NOT NULL,
  score SMALLINT NOT NULL,
  scale_min SMALLINT NOT NULL DEFAULT 0,
  scale_max SMALLINT NOT NULL DEFAULT 10,
  notes TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_symptom_scores_profile
  ON patient_symptom_scores (profile_id, symptom_key, recorded_at DESC);

CREATE TABLE IF NOT EXISTS patient_daily_impacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES patient_submissions(id) ON DELETE SET NULL,
  adl_key TEXT NOT NULL,
  difficulty_level SMALLINT NOT NULL,
  needs_assistance BOOLEAN,
  notes TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_daily_impacts_profile
  ON patient_daily_impacts (profile_id, adl_key, recorded_at DESC);

CREATE TABLE IF NOT EXISTS patient_followup_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES patient_submissions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  description TEXT,
  linked_document_id UUID REFERENCES patient_documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_followup_events_profile
  ON patient_followup_events (profile_id, occurred_at DESC);
