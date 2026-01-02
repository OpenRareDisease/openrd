-- PostgreSQL initialization script for the FSHD-openrd platform.
-- Usage:
--   psql -U postgres -f db/init_db.sql
-- This script creates the primary application database, extensions,
-- schemas, and core tables required for early development.

\connect postgres

-- Create the application database if it does not already exist.
SELECT 'CREATE DATABASE fshd_openrd'
WHERE NOT EXISTS (
    SELECT FROM pg_database WHERE datname = 'fshd_openrd'
)\gexec

\connect fshd_openrd

-- Enable useful extensions.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;

-- Users and authentication.
CREATE TABLE IF NOT EXISTS app_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number    CITEXT UNIQUE NOT NULL,
    email           CITEXT UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'patient',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Patient profile data.
CREATE TABLE IF NOT EXISTS patient_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    full_name           TEXT,
    preferred_name      TEXT,
    date_of_birth       DATE,
    gender              TEXT,
    patient_code        TEXT,
    diagnosis_stage     TEXT,
    diagnosis_date      DATE,
    genetic_mutation    TEXT,
    height_cm           NUMERIC(5,2),
    weight_kg           NUMERIC(5,2),
    blood_type          TEXT,
    contact_phone       CITEXT,
    contact_email       CITEXT,
    primary_physician   TEXT,
    region_province     TEXT,
    region_city         TEXT,
    region_district     TEXT,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE patient_profiles
    ADD COLUMN IF NOT EXISTS preferred_name TEXT,
    ADD COLUMN IF NOT EXISTS patient_code TEXT,
    ADD COLUMN IF NOT EXISTS diagnosis_date DATE,
    ADD COLUMN IF NOT EXISTS genetic_mutation TEXT,
    ADD COLUMN IF NOT EXISTS height_cm NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS blood_type TEXT,
    ADD COLUMN IF NOT EXISTS contact_phone CITEXT,
    ADD COLUMN IF NOT EXISTS contact_email CITEXT,
    ADD COLUMN IF NOT EXISTS primary_physician TEXT,
    ADD COLUMN IF NOT EXISTS region_province TEXT,
    ADD COLUMN IF NOT EXISTS region_city TEXT,
    ADD COLUMN IF NOT EXISTS region_district TEXT;

ALTER TABLE patient_profiles
    DROP COLUMN IF EXISTS muscle_strength;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uniq_patient_profiles_patient_code'
    ) THEN
        EXECUTE 'CREATE UNIQUE INDEX uniq_patient_profiles_patient_code ON patient_profiles (patient_code) WHERE patient_code IS NOT NULL';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uniq_patient_profiles_user_id'
    ) THEN
        EXECUTE 'CREATE UNIQUE INDEX uniq_patient_profiles_user_id ON patient_profiles (user_id)';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Muscle strength measurements linked to a patient profile.
CREATE TABLE IF NOT EXISTS patient_measurements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id      UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    muscle_group    TEXT NOT NULL,
    strength_score  SMALLINT NOT NULL CHECK (strength_score BETWEEN 0 AND 5),
    method          TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_measurements_profile
    ON patient_measurements (profile_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_measurements_latest
    ON patient_measurements (profile_id, muscle_group, recorded_at DESC);

-- Functional test results (e.g., stair climb time, six-minute walk).
CREATE TABLE IF NOT EXISTS patient_function_tests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id      UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
    test_type       TEXT NOT NULL,
    measured_value  NUMERIC(10,2),
    unit            TEXT,
    performed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_function_tests_profile
    ON patient_function_tests (profile_id, performed_at DESC);

-- Daily activity logs captured via manual entry or voice transcription.
CREATE TABLE IF NOT EXISTS patient_activity_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id      UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
    log_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    source          TEXT NOT NULL,
    content         TEXT,
    mood_score      SMALLINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_activity_logs_profile
    ON patient_activity_logs (profile_id, log_date DESC);

-- Medication management.
CREATE TABLE IF NOT EXISTS patient_medications (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id       UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
    medication_name  TEXT NOT NULL,
    dosage           TEXT,
    frequency        TEXT,
    route            TEXT,
    start_date       DATE,
    end_date         DATE,
    notes            TEXT,
    status           TEXT NOT NULL DEFAULT 'active',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_medications_profile
    ON patient_medications (profile_id);

-- Uploaded medical document metadata.
CREATE TABLE IF NOT EXISTS patient_documents (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id       UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
    document_type    TEXT NOT NULL,
    title            TEXT,
    file_name        TEXT,
    mime_type        TEXT,
    file_size_bytes  BIGINT,
    storage_uri      TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'uploaded',
    uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checksum         TEXT,
    ocr_payload      JSONB
);

CREATE INDEX IF NOT EXISTS idx_patient_documents_profile
    ON patient_documents (profile_id, document_type);

ALTER TABLE patient_documents
    ADD COLUMN IF NOT EXISTS ocr_payload JSONB;

-- Medical reports (metadata only, files stored elsewhere).
CREATE TABLE IF NOT EXISTS medical_reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    report_type     TEXT NOT NULL,
    report_date     DATE NOT NULL,
    storage_uri     TEXT NOT NULL,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Community posts and interactions.
CREATE TABLE IF NOT EXISTS community_posts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id       UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    tags            TEXT[] DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_comments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id         UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clinical trials and matching information.
CREATE TABLE IF NOT EXISTS clinical_trials (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           TEXT NOT NULL,
    sponsor         TEXT,
    description     TEXT,
    location        TEXT,
    inclusion_criteria TEXT,
    exclusion_criteria TEXT,
    start_date      DATE,
    end_date        DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_trial_matches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    trial_id        UUID NOT NULL REFERENCES clinical_trials(id) ON DELETE CASCADE,
    match_status    TEXT NOT NULL DEFAULT 'pending',
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes           TEXT
);

-- Audit log for compliance tracking.
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES app_users(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    event_payload   JSONB NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medical_reports_user_id
    ON medical_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_author_id
    ON community_posts (author_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_post_id
    ON community_comments (post_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_author_id
    ON community_comments (author_id);
CREATE INDEX IF NOT EXISTS idx_patient_trial_matches_user_id
    ON patient_trial_matches (user_id);
CREATE INDEX IF NOT EXISTS idx_patient_trial_matches_trial_id
    ON patient_trial_matches (trial_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
    ON audit_logs (user_id);

-- Update triggers to keep timestamps in sync.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_users_set_updated_at ON app_users;
CREATE TRIGGER app_users_set_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS patient_profiles_set_updated_at ON patient_profiles;
CREATE TRIGGER patient_profiles_set_updated_at
BEFORE UPDATE ON patient_profiles
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS community_posts_set_updated_at ON community_posts;
CREATE TRIGGER community_posts_set_updated_at
BEFORE UPDATE ON community_posts
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

-- Grant read/write privileges to application role if it exists.
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM pg_roles WHERE rolname = 'openrd_app'
    ) THEN
        GRANT CONNECT ON DATABASE fshd_openrd TO openrd_app;
       GRANT USAGE ON SCHEMA public TO openrd_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openrd_app;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openrd_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openrd_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT USAGE, SELECT ON SEQUENCES TO openrd_app;
    END IF;
END;
$$ LANGUAGE plpgsql;
