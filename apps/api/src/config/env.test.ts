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

    expect(env.isProduction).toBe(true);
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
});
