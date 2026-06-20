import { afterEach, describe, expect, it } from 'vitest';
import { loadAppEnv, parseOtpAllowlist, resetAppEnvCache } from './env.js';

// A complete, valid production env. Each test spreads this and overrides
// only the field under test. OTP_PROVIDER=tencent requires its five SMS
// credentials, so they live in the base too — a test that needs a
// different provider just overrides OTP_PROVIDER (+ that provider's
// fields); the unused tencent creds are harmless.
const prodBase: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://prod-user:prod-pass@db.internal:5432/openrd',
  DATABASE_SSL_ENABLED: 'true',
  DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
  JWT_SECRET: 'prod-jwt-secret-1234567890',
  OTP_HASH_SECRET: 'prod-otp-secret-1234567890',
  OTP_PROVIDER: 'tencent',
  TENCENT_SECRET_ID: 'AKIDtestsecretid000000000000',
  TENCENT_SECRET_KEY: 'test-secret-key-000000000000',
  TENCENT_SMS_SDK_APP_ID: '1400006666',
  TENCENT_SMS_SIGN_NAME: '测试签名',
  TENCENT_SMS_TEMPLATE_ID: '1110',
  CORS_ORIGIN: 'https://app.example.com',
  OCR_PROVIDER: 'embedded',
  KB_SERVICE_TOKEN: 'prod-kb-bearer-token-1234567890',
};

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
    const env = loadAppEnv(prodBase);
    expect(env.isProductionLike).toBe(true);
    expect(env.CORS_ORIGIN).toBe('https://app.example.com');
    expect(env.OTP_PROVIDER).toBe('tencent');
  });

  it('accepts prod with empty optional API keys (AI / OPENAI / CHROMA)', () => {
    // Regression: these used `.min(1).optional()`, which REJECTS an
    // empty string (`AI_API_KEY=`) instead of treating it as unset —
    // crashing prod boot when .env carried the .env.example blanks.
    const env = loadAppEnv({
      ...prodBase,
      OPENAI_API_KEY: '',
      AI_API_KEY: '',
      CHROMA_API_KEY: '',
      CHROMA_TENANT_ID: '',
    });
    expect(env.AI_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('rejects prod with SSL disabled and no insecure ack', () => {
    // DB transport encryption can't silently degrade to plaintext — a
    // remote DB that forgot DATABASE_SSL_ENABLED must fail-fast, not
    // send PHI in cleartext.
    expect(() => loadAppEnv({ ...prodBase, DATABASE_SSL_ENABLED: 'false' })).toThrow(
      /SSL disabled|DATABASE_ALLOW_INSECURE/,
    );
  });

  it('accepts prod with SSL disabled when DATABASE_ALLOW_INSECURE acks it', () => {
    // compose-internal / private-network Postgres: no SSL, but an
    // explicit operator ack.
    const env = loadAppEnv({
      ...prodBase,
      DATABASE_SSL_ENABLED: 'false',
      DATABASE_ALLOW_INSECURE: 'true',
    });
    expect(env.DATABASE_ALLOW_INSECURE).toBe(true);
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
    expect(() => loadAppEnv({ ...prodBase, KB_SERVICE_TOKEN: undefined })).toThrow(
      /KB_SERVICE_TOKEN is required in production/,
    );
  });

  it('rejects a production config that ships docker-compose dev placeholders', () => {
    // docker-compose defaults KB_SERVICE_TOKEN to a well-named dev
    // placeholder so a fresh clone runs; a prod deploy that forgets to
    // override would inherit it. isDevPlaceholder catches that.
    expect(() =>
      loadAppEnv({ ...prodBase, KB_SERVICE_TOKEN: 'dev-only-local-token-NOT-FOR-PROD' }),
    ).toThrow(/dev placeholder|cannot be reached anonymously/);
  });

  it('rejects a production config that ships the .env.example JWT_SECRET placeholder', () => {
    expect(() =>
      loadAppEnv({
        ...prodBase,
        JWT_SECRET: 'change-me-super-secret',
        OTP_HASH_SECRET: 'change-me-otp-secret',
      }),
    ).toThrow(/JWT_SECRET must be replaced|OTP_HASH_SECRET must be replaced/);
  });

  it('rejects OTP_PROVIDER=tencent that is missing SMS credentials', () => {
    // Real SMS provider: every credential must be present, else SendSms
    // fails at runtime AFTER a code is already issued + stored. Fail
    // fast at boot, naming exactly which creds are missing.
    expect(() =>
      loadAppEnv({
        ...prodBase,
        TENCENT_SECRET_KEY: undefined,
        TENCENT_SMS_TEMPLATE_ID: undefined,
      }),
    ).toThrow(/OTP_PROVIDER=tencent requires.*TENCENT_SECRET_KEY.*TENCENT_SMS_TEMPLATE_ID/);
  });

  it('accepts NODE_ENV=staging as a first-class value (PR-Sec-11)', () => {
    // staging parses cleanly AND falls under isProductionLike, so
    // validateProductionEnv runs against it.
    const env = loadAppEnv({
      ...prodBase,
      NODE_ENV: 'staging',
      DATABASE_URL: 'postgres://staging:pw@db.staging:5432/openrd',
      JWT_SECRET: 'staging-jwt-secret-1234567890',
      OTP_HASH_SECRET: 'staging-otp-secret-1234567890',
      CORS_ORIGIN: 'https://app.staging.example.com',
      KB_SERVICE_TOKEN: 'staging-kb-bearer-token-1234567890',
    });
    expect(env.NODE_ENV).toBe('staging');
    expect(env.isProductionLike).toBe(true);
    expect(env.isStaging).toBe(true);
  });

  it('rejects a staging config that ships dev placeholders (PR-Sec-11)', () => {
    // staging gets the SAME placeholder rejection production does.
    expect(() =>
      loadAppEnv({
        ...prodBase,
        NODE_ENV: 'staging',
        JWT_SECRET: 'change-me-super-secret',
        OTP_HASH_SECRET: 'change-me-otp-secret',
      }),
    ).toThrow(/JWT_SECRET must be replaced|OTP_HASH_SECRET must be replaced/);
  });

  it('rejects internal_test OTP with an empty allowlist', () => {
    expect(() =>
      loadAppEnv({
        ...prodBase,
        OTP_PROVIDER: 'internal_test',
        OTP_TEST_FIXED_CODE: '123456',
        // OTP_TEST_PHONE_ALLOWLIST omitted → empty → must reject
      }),
    ).toThrow(/OTP_TEST_PHONE_ALLOWLIST/);
  });

  it('rejects internal_test OTP with a wrong-length fixed code', () => {
    expect(() =>
      loadAppEnv({
        ...prodBase,
        OTP_PROVIDER: 'internal_test',
        OTP_TEST_PHONE_ALLOWLIST: '+8613800000000',
        OTP_TEST_FIXED_CODE: '12', // not 6 digits → must reject
      }),
    ).toThrow(/OTP_TEST_FIXED_CODE/);
  });

  it('accepts internal_test OTP with a non-empty allowlist + valid code', () => {
    const env = loadAppEnv({
      ...prodBase,
      OTP_PROVIDER: 'internal_test',
      OTP_TEST_PHONE_ALLOWLIST: '+8613800000000, +8613900000001',
      OTP_TEST_FIXED_CODE: '123456',
    });
    expect(env.OTP_PROVIDER).toBe('internal_test');
  });
});

describe('parseOtpAllowlist', () => {
  // Shared by validateProductionEnv (boot gate) and OtpService (auth
  // gate). Pin the shape so a future format change can't silently
  // diverge the two callers.
  it('trims, drops empties, and tolerates a trailing comma', () => {
    expect(parseOtpAllowlist('+8613800000000, +8613900000001 ,')).toEqual([
      '+8613800000000',
      '+8613900000001',
    ]);
  });

  it('returns an empty array for blank / whitespace-only input', () => {
    expect(parseOtpAllowlist('')).toEqual([]);
    expect(parseOtpAllowlist('   ')).toEqual([]);
    expect(parseOtpAllowlist(' , , ')).toEqual([]);
  });
});
