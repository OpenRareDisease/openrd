import { afterEach, describe, expect, it } from 'vitest';
import { loadAppEnv, resetAppEnvCache } from './env.js';

describe('loadAppEnv', () => {
  afterEach(() => {
    resetAppEnvCache();
  });

  it('rejects unsafe production defaults', () => {
    expect(() =>
      loadAppEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/fshd_openrd',
        JWT_SECRET: 'change-me-super-secret',
        OTP_HASH_SECRET: 'change-me-otp-secret',
        OTP_PROVIDER: 'mock',
        CORS_ORIGIN: '*',
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('accepts explicit production configuration', () => {
    const env = loadAppEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://prod-user:prod-pass@db.internal:5432/openrd',
      DATABASE_SSL_ENABLED: 'true',
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
      JWT_SECRET: 'prod-jwt-secret-1234567890',
      OTP_HASH_SECRET: 'prod-otp-secret-1234567890',
      OTP_PROVIDER: 'tencent',
      CORS_ORIGIN: 'https://app.example.com',
      OCR_PROVIDER: 'embedded',
      KB_SERVICE_TOKEN: 'prod-kb-bearer-token-1234567890',
    });

    expect(env.isProductionLike).toBe(true);
    expect(env.CORS_ORIGIN).toBe('https://app.example.com');
    expect(env.OTP_PROVIDER).toBe('tencent');
  });

  it('requires MinIO settings when STORAGE_PROVIDER=minio', () => {
    expect(() =>
      loadAppEnv({
        NODE_ENV: 'development',
        STORAGE_PROVIDER: 'minio',
      }),
    ).toThrow(/MINIO_ENDPOINT must be configured/);
  });

  it('rejects a production config that omits KB_SERVICE_TOKEN', () => {
    expect(() =>
      loadAppEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://prod-user:prod-pass@db.internal:5432/openrd',
        DATABASE_SSL_ENABLED: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
        JWT_SECRET: 'prod-jwt-secret-1234567890',
        OTP_HASH_SECRET: 'prod-otp-secret-1234567890',
        OTP_PROVIDER: 'tencent',
        CORS_ORIGIN: 'https://app.example.com',
        OCR_PROVIDER: 'embedded',
      }),
    ).toThrow(/KB_SERVICE_TOKEN is required in production/);
  });

  it('rejects a production config that ships docker-compose dev placeholders', () => {
    // The PR-Sec-8 audit caught this: docker-compose now defaults
    // KB_SERVICE_TOKEN to `dev-only-local-token-NOT-FOR-PROD` so a
    // fresh clone can run `docker compose up`. A prod deploy that
    // forgets to override the env would inherit that placeholder and
    // the existing `!env.KB_SERVICE_TOKEN` check (empty-only) would
    // NOT fire. The expanded `isDevPlaceholder` set catches it.
    expect(() =>
      loadAppEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://prod-user:prod-pass@db.internal:5432/openrd',
        DATABASE_SSL_ENABLED: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
        JWT_SECRET: 'prod-jwt-secret-1234567890',
        OTP_HASH_SECRET: 'prod-otp-secret-1234567890',
        OTP_PROVIDER: 'tencent',
        CORS_ORIGIN: 'https://app.example.com',
        OCR_PROVIDER: 'embedded',
        KB_SERVICE_TOKEN: 'dev-only-local-token-NOT-FOR-PROD',
      }),
    ).toThrow(/dev placeholder|cannot be reached anonymously/);
  });

  it('rejects a production config that ships the .env.example JWT_SECRET placeholder', () => {
    expect(() =>
      loadAppEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://prod-user:prod-pass@db.internal:5432/openrd',
        DATABASE_SSL_ENABLED: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
        // The two placeholders from .env.example
        JWT_SECRET: 'change-me-super-secret',
        OTP_HASH_SECRET: 'change-me-otp-secret',
        OTP_PROVIDER: 'tencent',
        CORS_ORIGIN: 'https://app.example.com',
        OCR_PROVIDER: 'embedded',
        KB_SERVICE_TOKEN: 'prod-kb-bearer-token-1234567890',
      }),
    ).toThrow(/JWT_SECRET must be replaced|OTP_HASH_SECRET must be replaced/);
  });

  it('accepts NODE_ENV=staging as a first-class value (PR-Sec-11)', () => {
    // Before PR-Sec-11 the enum was {dev, test, production}; a
    // staging deploy with `NODE_ENV=staging` would throw "Invalid
    // enum value" at schema parse time and the operator had to
    // either drop NODE_ENV (silent dev fallback, accepts every
    // placeholder) or set production (conflates staging+prod in
    // metrics). Staging now parses cleanly AND falls under
    // `isProductionLike` so `validateProductionEnv` runs against it.
    const env = loadAppEnv({
      NODE_ENV: 'staging',
      DATABASE_URL: 'postgres://staging:pw@db.staging:5432/openrd',
      DATABASE_SSL_ENABLED: 'true',
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
      JWT_SECRET: 'staging-jwt-secret-1234567890',
      OTP_HASH_SECRET: 'staging-otp-secret-1234567890',
      OTP_PROVIDER: 'tencent',
      CORS_ORIGIN: 'https://app.staging.example.com',
      OCR_PROVIDER: 'embedded',
      KB_SERVICE_TOKEN: 'staging-kb-bearer-token-1234567890',
    });
    expect(env.NODE_ENV).toBe('staging');
    expect(env.isProductionLike).toBe(true);
    expect(env.isStaging).toBe(true);
  });

  it('rejects a staging config that ships dev placeholders (PR-Sec-11)', () => {
    // Pin the harder half of the staging fix: staging gets the SAME
    // placeholder rejection that production does. Without this, an
    // operator who set NODE_ENV=staging but forgot to rotate
    // JWT_SECRET would ship with `change-me-super-secret`.
    expect(() =>
      loadAppEnv({
        NODE_ENV: 'staging',
        DATABASE_URL: 'postgres://staging:pw@db.staging:5432/openrd',
        DATABASE_SSL_ENABLED: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
        JWT_SECRET: 'change-me-super-secret',
        OTP_HASH_SECRET: 'change-me-otp-secret',
        OTP_PROVIDER: 'tencent',
        CORS_ORIGIN: 'https://app.staging.example.com',
        OCR_PROVIDER: 'embedded',
        KB_SERVICE_TOKEN: 'staging-kb-bearer-token-1234567890',
      }),
    ).toThrow(/JWT_SECRET must be replaced|OTP_HASH_SECRET must be replaced/);
  });

  it('rejects internal_test OTP with an empty allowlist', () => {
    expect(() =>
      loadAppEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://prod-user:prod-pass@db.internal:5432/openrd',
        DATABASE_SSL_ENABLED: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
        JWT_SECRET: 'prod-jwt-secret-1234567890',
        OTP_HASH_SECRET: 'prod-otp-secret-1234567890',
        OTP_PROVIDER: 'internal_test',
        CORS_ORIGIN: 'https://app.example.com',
        OCR_PROVIDER: 'embedded',
        KB_SERVICE_TOKEN: 'prod-kb-bearer-token-1234567890',
        OTP_TEST_FIXED_CODE: '123456',
        // OTP_TEST_PHONE_ALLOWLIST omitted → empty → must reject
      }),
    ).toThrow(/OTP_TEST_PHONE_ALLOWLIST/);
  });

  it('rejects internal_test OTP with a wrong-length fixed code', () => {
    expect(() =>
      loadAppEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://prod-user:prod-pass@db.internal:5432/openrd',
        DATABASE_SSL_ENABLED: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
        JWT_SECRET: 'prod-jwt-secret-1234567890',
        OTP_HASH_SECRET: 'prod-otp-secret-1234567890',
        OTP_PROVIDER: 'internal_test',
        CORS_ORIGIN: 'https://app.example.com',
        OCR_PROVIDER: 'embedded',
        KB_SERVICE_TOKEN: 'prod-kb-bearer-token-1234567890',
        OTP_TEST_PHONE_ALLOWLIST: '+8613800000000',
        OTP_TEST_FIXED_CODE: '12', // not 6 digits → must reject
      }),
    ).toThrow(/OTP_TEST_FIXED_CODE/);
  });

  it('accepts internal_test OTP with a non-empty allowlist + valid code', () => {
    const env = loadAppEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://prod-user:prod-pass@db.internal:5432/openrd',
      DATABASE_SSL_ENABLED: 'true',
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
      JWT_SECRET: 'prod-jwt-secret-1234567890',
      OTP_HASH_SECRET: 'prod-otp-secret-1234567890',
      OTP_PROVIDER: 'internal_test',
      CORS_ORIGIN: 'https://app.example.com',
      OCR_PROVIDER: 'embedded',
      KB_SERVICE_TOKEN: 'prod-kb-bearer-token-1234567890',
      OTP_TEST_PHONE_ALLOWLIST: '+8613800000000, +8613900000001',
      OTP_TEST_FIXED_CODE: '123456',
    });
    expect(env.OTP_PROVIDER).toBe('internal_test');
  });
});
