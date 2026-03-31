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
});
