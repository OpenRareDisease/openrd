import { afterEach, describe, expect, it } from 'vitest';
import { loadAppEnv, parseOtpAllowlist, resetAppEnvCache } from './env.js';

// A complete, valid production env. Each test spreads this and overrides
// only the field under test. OTP_PROVIDER=tencent requires its five SMS
// credentials, so they live in the base too — a test that needs a
// different provider just overrides OTP_PROVIDER (+ that provider's
// fields); the unused tencent creds are harmless.
// Every secret here is >= 32 chars with plenty of distinct characters,
// because validateProductionEnv now enforces that (assertStrongSecret).
// AI_API_KEY and the storage/TLS acks are spelled out rather than left
// to inherit whatever the developer's own apps/api/.env happens to
// carry — loadAppEnv merges process.env underneath these overrides, so
// an omitted key here would make the test's result depend on the
// machine it runs on.
const prodBase: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://prod-user:prod-pass@db.internal:5432/openrd',
  DATABASE_SSL_ENABLED: 'true',
  DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
  JWT_SECRET: 'f3a91c7e5b204d68a1c0e97b2d4f6a8c',
  OTP_HASH_SECRET: '7b2e4d9a1c6f80e3b5d7a92c4e6f1038',
  OTP_PROVIDER: 'tencent',
  TENCENT_SECRET_ID: 'AKIDtestsecretid000000000000',
  TENCENT_SECRET_KEY: 'test-secret-key-000000000000',
  TENCENT_SMS_SDK_APP_ID: '1400006666',
  TENCENT_SMS_SIGN_NAME: '测试签名',
  TENCENT_SMS_TEMPLATE_ID: '1110',
  CORS_ORIGIN: 'https://app.example.com',
  OCR_PROVIDER: 'embedded',
  KB_SERVICE_TOKEN: 'prod-kb-bearer-token-1234567890',
  AI_API_KEY: 'sk-prod-ai-key-0000000000000000',
  AI_API_BASE_URL: 'https://api.siliconflow.cn/v1',
  STORAGE_PROVIDER: 'local',
  STORAGE_ALLOW_LOCAL: 'true',
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

  it('coerces empty optional API keys (AI / OPENAI / CHROMA) to undefined', () => {
    // Regression: these used `.min(1).optional()`, which REJECTS an
    // empty string (`AI_API_KEY=`) instead of treating it as unset —
    // crashing boot with a zod parse error when .env carried the
    // .env.example blanks. Asserted in development because production
    // now (correctly) refuses to boot without an AI key at all; the
    // property under test here is the coercion, not the acceptance.
    const env = loadAppEnv({
      NODE_ENV: 'development',
      OPENAI_API_KEY: '',
      AI_API_KEY: '',
      CHROMA_API_KEY: '',
      CHROMA_TENANT_ID: '',
    });
    expect(env.AI_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CHROMA_API_KEY).toBeUndefined();
  });

  it('reports a blank prod AI key as a missing-config error, not a parse error', () => {
    // The empty-string coercion must stay ahead of the production gate:
    // an operator who left `AI_API_KEY=` in .env should read 「required
    // in production」, not zod's 「String must contain at least 1
    // character」, which says nothing about what to do.
    expect(() => loadAppEnv({ ...prodBase, AI_API_KEY: '', OPENAI_API_KEY: '' })).toThrow(
      /Invalid environment configuration: AI_API_KEY/,
    );
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
      JWT_SECRET: '0d4c8b1f6e39a72c5d08b3f7e1a94c62',
      OTP_HASH_SECRET: 'a91f37e2c8b04d6f5a7c93e18b2d40f6',
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

  // --- signing / HMAC secret strength -------------------------------

  it('rejects a production JWT_SECRET shorter than 32 characters', () => {
    // `openrd-prod-2026` shape: passes zod's .min(16) and is not a known
    // placeholder, so before assertStrongSecret it reached production.
    expect(() => loadAppEnv({ ...prodBase, JWT_SECRET: 'openrd-prod-2026' })).toThrow(
      /JWT_SECRET must be at least 32 characters/,
    );
  });

  it('rejects a long but low-entropy production JWT_SECRET', () => {
    // 36 chars, but a passphrase padded by repetition — length alone is
    // not the property that makes an HS256 key unforgeable.
    expect(() =>
      loadAppEnv({ ...prodBase, JWT_SECRET: 'abababababababababababababababababab' }),
    ).toThrow(/JWT_SECRET looks low-entropy/);
  });

  it('accepts an `openssl rand -hex 32` production JWT_SECRET', () => {
    // Regression guard on the STRENGTH RULE ITSELF: hex output is
    // lowercase + digits, i.e. only two character classes, so the
    // obvious "must mix upper/lower/digit/symbol" check would reject
    // the very command .env.example tells operators to run.
    const env = loadAppEnv({
      ...prodBase,
      JWT_SECRET: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    });
    expect(env.JWT_SECRET).toHaveLength(64);
  });

  it('rejects a production OTP_HASH_SECRET shorter than 32 characters', () => {
    expect(() => loadAppEnv({ ...prodBase, OTP_HASH_SECRET: 'otp-secret-2026' })).toThrow(
      /OTP_HASH_SECRET must be at least 32 characters/,
    );
  });

  // --- DATABASE_URL default-credential rejection ---------------------

  it('rejects the compose-internal DATABASE_URL that still uses postgres:postgres', () => {
    // The old check compared against the `@localhost:5432` literal only,
    // so THIS string — what docker-compose actually injects — sailed
    // through the gate it existed for.
    expect(() =>
      loadAppEnv({
        ...prodBase,
        DATABASE_URL: 'postgres://postgres:postgres@postgres:5432/fshd_openrd',
      }),
    ).toThrow(/postgres:postgres credential pair/);
  });

  it('rejects the .env.example DATABASE_URL literal in production', () => {
    expect(() =>
      loadAppEnv({
        ...prodBase,
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/fshd_openrd',
      }),
    ).toThrow(/postgres:postgres credential pair/);
  });

  it('accepts a compose-internal host with a dedicated role', () => {
    // The rule is about the credential pair, NOT the hostname: reaching
    // Postgres as `postgres:5432` over the private bridge network is a
    // legitimate production topology and must keep working.
    const env = loadAppEnv({
      ...prodBase,
      DATABASE_URL: 'postgres://openrd_app:s3cr3t-rotated@postgres:5432/fshd_openrd',
      DATABASE_SSL_ENABLED: 'false',
      DATABASE_ALLOW_INSECURE: 'true',
    });
    expect(env.DATABASE_URL).toContain('@postgres:5432');
  });

  // --- AI configuration ----------------------------------------------

  it('rejects production with neither AI_API_KEY nor OPENAI_API_KEY', () => {
    // Without this the container boots clean and reports ready while
    // every patient question answers 「AI 服务未配置」.
    expect(() =>
      loadAppEnv({ ...prodBase, AI_API_KEY: undefined, OPENAI_API_KEY: undefined }),
    ).toThrow(/AI_API_KEY \(or OPENAI_API_KEY\) is required in production/);
  });

  it('accepts production when only OPENAI_API_KEY is set', () => {
    const env = loadAppEnv({
      ...prodBase,
      AI_API_KEY: undefined,
      OPENAI_API_KEY: 'sk-openai-key-000000000000000000',
    });
    expect(env.AI_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBe('sk-openai-key-000000000000000000');
  });

  it('rejects an unacknowledged non-.cn AI_API_BASE_URL in production', () => {
    expect(() =>
      loadAppEnv({ ...prodBase, AI_API_BASE_URL: 'https://api.siliconflow.com/v1' }),
    ).toThrow(/cross-border transfer of health data/);
  });

  it('accepts a non-.cn AI_API_BASE_URL once the cross-border ack is set', () => {
    const env = loadAppEnv({
      ...prodBase,
      AI_API_BASE_URL: 'https://api.siliconflow.com/v1',
      AI_CROSS_BORDER_ACKNOWLEDGED: 'true',
    });
    expect(env.AI_CROSS_BORDER_ACKNOWLEDGED).toBe(true);
  });

  // --- OCR provider credentials --------------------------------------

  it('rejects OCR_PROVIDER=baidu that is missing its credentials', () => {
    // Symmetric with the tencent branch: a missing key here does not
    // fail, it silently swaps the OCR engine for every patient document.
    expect(() =>
      loadAppEnv({ ...prodBase, OCR_PROVIDER: 'baidu', BAIDU_OCR_SECRET_KEY: undefined }),
    ).toThrow(/OCR_PROVIDER=baidu requires/);
  });

  it('accepts OCR_PROVIDER=baidu with both credentials', () => {
    const env = loadAppEnv({
      ...prodBase,
      OCR_PROVIDER: 'baidu',
      BAIDU_OCR_API_KEY: 'baidu-api-key',
      BAIDU_OCR_SECRET_KEY: 'baidu-secret-key',
    });
    expect(env.OCR_PROVIDER).toBe('baidu');
  });

  // --- storage --------------------------------------------------------

  it('rejects production on local storage without an explicit ack', () => {
    // `local` is the default in the schema, .env.example and compose, so
    // this is what an operator who never touched the setting gets:
    // patient files on one unreplicated container volume.
    expect(() => loadAppEnv({ ...prodBase, STORAGE_ALLOW_LOCAL: 'false' })).toThrow(
      /STORAGE_ALLOW_LOCAL=true/,
    );
  });

  it('rejects production minio over plaintext without an insecure ack', () => {
    expect(() =>
      loadAppEnv({
        ...prodBase,
        STORAGE_PROVIDER: 'minio',
        STORAGE_ALLOW_LOCAL: undefined,
        MINIO_ENDPOINT: 's3.example.com',
        MINIO_ACCESS_KEY: 'prod-access-key',
        MINIO_SECRET_KEY: 'prod-secret-key-0000000000',
        MINIO_USE_HTTPS: 'false',
      }),
    ).toThrow(/object storage has TLS disabled/);
  });

  it('accepts compose-internal minio over plaintext when acknowledged', () => {
    const env = loadAppEnv({
      ...prodBase,
      STORAGE_PROVIDER: 'minio',
      STORAGE_ALLOW_LOCAL: undefined,
      MINIO_ENDPOINT: 'minio:9000',
      MINIO_ACCESS_KEY: 'prod-access-key',
      MINIO_SECRET_KEY: 'prod-secret-key-0000000000',
      MINIO_USE_HTTPS: 'false',
      MINIO_ALLOW_INSECURE: 'true',
    });
    expect(env.STORAGE_PROVIDER).toBe('minio');
  });

  it('accepts production minio over TLS with rotated credentials', () => {
    const env = loadAppEnv({
      ...prodBase,
      STORAGE_PROVIDER: 'minio',
      STORAGE_ALLOW_LOCAL: undefined,
      MINIO_ENDPOINT: 's3.example.com',
      MINIO_ACCESS_KEY: 'prod-access-key',
      MINIO_SECRET_KEY: 'prod-secret-key-0000000000',
      MINIO_USE_HTTPS: 'true',
    });
    expect(env.MINIO_USE_HTTPS).toBe(true);
  });

  it('still rejects the minioadmin demo credentials in production', () => {
    expect(() =>
      loadAppEnv({
        ...prodBase,
        STORAGE_PROVIDER: 'minio',
        STORAGE_ALLOW_LOCAL: undefined,
        MINIO_ENDPOINT: 'minio:9000',
        MINIO_ACCESS_KEY: 'minioadmin',
        MINIO_SECRET_KEY: 'minioadmin12345678',
        MINIO_ALLOW_INSECURE: 'true',
      }),
    ).toThrow(/MINIO_ACCESS_KEY must be replaced|MINIO_SECRET_KEY must be replaced/);
  });

  // --- development stays permissive -----------------------------------

  it('leaves development alone: every placeholder in .env.example boots', () => {
    // The whole gate is downstream of NODE_ENV. This is the property
    // that lets .env.example keep working defaults, so it is worth a
    // test of its own: a dev copy of .env.example must never fail-fast.
    const env = loadAppEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/fshd_openrd',
      JWT_SECRET: 'change-me-super-secret',
      OTP_HASH_SECRET: 'change-me-otp-secret',
      OTP_PROVIDER: 'mock',
      CORS_ORIGIN: '*',
      STORAGE_PROVIDER: 'local',
      AI_API_KEY: '',
      OPENAI_API_KEY: '',
    });
    expect(env.isProductionLike).toBe(false);
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
