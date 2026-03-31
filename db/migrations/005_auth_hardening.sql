CREATE TABLE IF NOT EXISTS auth_login_guards (
  identifier CITEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_login_guards_locked_until
  ON auth_login_guards (locked_until);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS auth_login_guards_set_updated_at ON auth_login_guards;
    CREATE TRIGGER auth_login_guards_set_updated_at
    BEFORE UPDATE ON auth_login_guards
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();
  END IF;
END;
$$ LANGUAGE plpgsql;
