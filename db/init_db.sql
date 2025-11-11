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
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    full_name       TEXT,
    date_of_birth   DATE,
    gender          TEXT,
    diagnosis_stage TEXT,
    muscle_strength JSONB,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- Update triggers to keep timestamps in sync.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_users_set_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER patient_profiles_set_updated_at
BEFORE UPDATE ON patient_profiles
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

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
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openrd_app;
    END IF;
END;
$$ LANGUAGE plpgsql;
