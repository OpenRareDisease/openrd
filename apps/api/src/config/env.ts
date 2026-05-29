import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

const booleanish = () =>
  z.preprocess((value) => {
    if (value === '' || value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    }
    return value;
  }, z.boolean());

const optionalNonEmptyString = () =>
  z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());

const envSchema = z
  .object({
    // `staging` is treated as production-shaped (see `isProductionLike`
    // below + `validateProductionEnv`). Without it the zod parse step
    // throws "Invalid enum value" for any real staging deploy and the
    // operator has to choose between dropping NODE_ENV (silently falls
    // back to `development`, skipping the placeholder rejection) or
    // setting `production` (conflates staging + prod in metrics/logs).
    // Both are wrong defaults; making `staging` a first-class value
    // closes the gap.
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z
      .string()
      .min(1)
      .default('postgres://postgres:postgres@localhost:5432/fshd_openrd'),
    DATABASE_SSL_ENABLED: booleanish().default(false),
    DATABASE_SSL_REJECT_UNAUTHORIZED: booleanish().default(true),
    JWT_SECRET: z
      .string()
      .min(16, 'JWT_SECRET must be at least 16 characters long')
      .default('change-me-super-secret'),
    JWT_EXPIRES_IN: z.string().default('7d'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(6).max(14).default(10),
    CORS_ORIGIN: z.string().default('*'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    OTP_PROVIDER: z.enum(['mock', 'tencent', 'internal_test']).default('mock'),
    OTP_CODE_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
    OTP_RESEND_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
    OTP_MAX_SEND_PER_DAY: z.coerce.number().int().min(1).default(10),
    OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    // INTERNAL-TEST OTP bridge (OTP_PROVIDER=internal_test): temporary
    // until Tencent SMS is wired. Comma-separated allowlist of test
    // phone numbers allowed to log in, plus the fixed code they enter.
    // Both validated in validateProductionEnv when the provider is
    // active (allowlist non-empty, fixed code matches OTP_CODE_LENGTH).
    OTP_TEST_PHONE_ALLOWLIST: z.string().default(''),
    OTP_TEST_FIXED_CODE: z.string().default(''),
    OTP_HASH_SECRET: z.string().min(8).default('change-me-otp-secret'),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).default(60),
    AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(20),
    OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).default(60),
    OTP_SEND_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(5),
    AI_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).default(60),
    AI_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(6),
    AI_PROGRESS_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).default(60),
    AI_PROGRESS_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(30),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).max(20).default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    OPENAI_API_KEY: z.string().min(1).optional(),
    AI_API_KEY: z.string().min(1).optional(),
    AI_API_BASE_URL: z.string().url().default('https://api.siliconflow.cn/v1'),
    AI_API_MODEL: z.string().default('deepseek-ai/DeepSeek-V3'),
    AI_API_TIMEOUT: z.coerce.number().int().positive().default(30000),

    BAIDU_OCR_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    BAIDU_OCR_SECRET_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    BAIDU_OCR_GENERAL_ENDPOINT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),
    BAIDU_OCR_ACCURATE_ENDPOINT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),
    BAIDU_OCR_MEDICAL_ENDPOINT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),

    OCR_PROVIDER: z.enum(['embedded', 'baidu', 'mock']).default('embedded'),
    OCR_PYTHON_BIN: z.string().default('python3'),
    OCR_PARSER_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
    OCR_DISABLE_PADDLE: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),

    STORAGE_PROVIDER: z.enum(['local', 'minio']).default('local'),
    MINIO_ENDPOINT: optionalNonEmptyString(),
    MINIO_ACCESS_KEY: optionalNonEmptyString(),
    MINIO_SECRET_KEY: optionalNonEmptyString(),
    MINIO_BUCKET_NAME: z.string().default('medical-reports'),
    MINIO_USE_HTTPS: booleanish().default(false),

    KB_SERVICE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    KB_SERVICE_HOST: z.string().default('127.0.0.1'),
    KB_SERVICE_PORT: z.coerce.number().int().positive().default(5010),
    // Bearer token shared with the Python KB service. Forwarded as
    // `Authorization: Bearer ...` on every /multi request. Empty in
    // loopback dev; required in production (validated below).
    KB_SERVICE_TOKEN: optionalNonEmptyString(),
    CHROMA_API_KEY: z.string().min(1).optional(),
    CHROMA_TENANT_ID: z.string().min(1).optional(),
    CHROMA_DATABASE: z.string().default('FSHD'),
    CHROMA_COLLECTION: z.string().default('fshd_knowledge_base'),
    CHROMA_API_PORT: z.coerce.number().int().positive().default(5000),
    CHROMA_API_HOST: z.string().default('localhost'),
    HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
  })
  .transform((value) => ({
    ...value,
    // `isProductionLike` is the gate for `validateProductionEnv`.
    // Staging must satisfy the same secret-rotation + CORS / OTP /
    // OCR hardening that prod does — otherwise a staging deploy
    // could ship with `change-me-super-secret`, `OCR_PROVIDER=mock`,
    // or `CORS_ORIGIN=*` and the fail-fast wouldn't fire. The name
    // deliberately says "Like" instead of `isProduction` because the
    // value covers BOTH `NODE_ENV=production` and `NODE_ENV=staging`
    // — a `isProduction` field that returned true for staging would
    // mislead anyone reading consumer code without diving back to
    // this transform. `isStaging` stays separate for any metrics /
    // logging surface that wants to distinguish the two
    // environments (Sentry environment, log-aggregator tag, etc.).
    isProductionLike: value.NODE_ENV === 'production' || value.NODE_ENV === 'staging',
    isStaging: value.NODE_ENV === 'staging',
    isTest: value.NODE_ENV === 'test',
    chromaApiUrl: `http://${value.CHROMA_API_HOST}:${value.CHROMA_API_PORT}`,
    chromaApiBaseUrl: `http://${value.CHROMA_API_HOST}:${value.CHROMA_API_PORT}/api`,
    kbServiceUrl:
      value.KB_SERVICE_URL || `http://${value.KB_SERVICE_HOST}:${value.KB_SERVICE_PORT}`,
  }));

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

//: Known dev / placeholder secret values that MUST NOT appear in a
//: production env. Two families:
//:   - `change-me-*`         — the values that ship in `.env.example`
//:   - `dev-only-*-NOT-FOR-PROD` — the docker-compose fallback values
//: Mirrors the KB service's `_DEV_PLACEHOLDER_TOKEN` guard. A future
//: docker-compose default that adds a new placeholder must add itself
//: to this set or the fail-fast won't catch it. The strings are
//: deliberately verbatim — substring matching would risk false
//: positives against legitimate high-entropy secrets that happen to
//: contain "change-me".
const KNOWN_DEV_PLACEHOLDERS: ReadonlySet<string> = new Set([
  // .env.example defaults
  'change-me-super-secret',
  'change-me-otp-secret',
  // docker-compose fallbacks introduced by PR-Sec-5 / #55 follow-up
  'dev-only-local-token-NOT-FOR-PROD',
]);

const isDevPlaceholder = (value: string | undefined | null): boolean =>
  typeof value === 'string' && KNOWN_DEV_PLACEHOLDERS.has(value.trim());

const validateProductionEnv = (env: AppEnv) => {
  const errors: string[] = [];

  if (!env.isProductionLike) {
    return errors;
  }

  if (env.JWT_SECRET === 'change-me-super-secret' || isDevPlaceholder(env.JWT_SECRET)) {
    errors.push(
      'JWT_SECRET must be replaced in production (no `change-me-*` / `dev-only-*` value)',
    );
  }
  if (env.OTP_HASH_SECRET === 'change-me-otp-secret' || isDevPlaceholder(env.OTP_HASH_SECRET)) {
    errors.push(
      'OTP_HASH_SECRET must be replaced in production (no `change-me-*` / `dev-only-*` value)',
    );
  }
  if (env.DATABASE_URL === 'postgres://postgres:postgres@localhost:5432/fshd_openrd') {
    errors.push('DATABASE_URL must be replaced in production');
  }
  if (env.OTP_PROVIDER === 'mock') {
    errors.push('OTP_PROVIDER=mock is not allowed in production');
  }
  if (env.OTP_PROVIDER === 'internal_test') {
    // internal_test is an allowed prod-shaped provider (temporary
    // bridge until Tencent SMS lands), but ONLY with both guard rails
    // set, so a misconfig can't degrade into "anyone logs in" (an
    // empty allowlist would otherwise be meaningless) or ship an
    // absent / wrong-length fixed code.
    const allowlist = env.OTP_TEST_PHONE_ALLOWLIST.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowlist.length === 0) {
      errors.push('OTP_PROVIDER=internal_test requires a non-empty OTP_TEST_PHONE_ALLOWLIST');
    }
    if (!new RegExp(`^\\d{${env.OTP_CODE_LENGTH}}$`).test(env.OTP_TEST_FIXED_CODE)) {
      errors.push(
        `OTP_TEST_FIXED_CODE must be exactly ${env.OTP_CODE_LENGTH} digits ` +
          'when OTP_PROVIDER=internal_test',
      );
    }
  }
  if (env.CORS_ORIGIN.trim() === '*' || !env.CORS_ORIGIN.trim()) {
    errors.push('CORS_ORIGIN must be explicitly configured in production');
  }
  if (env.OCR_PROVIDER === 'mock') {
    errors.push('OCR_PROVIDER=mock is not allowed in production');
  }
  if (!env.KB_SERVICE_TOKEN || isDevPlaceholder(env.KB_SERVICE_TOKEN)) {
    errors.push(
      'KB_SERVICE_TOKEN is required in production so the KB service ' +
        'cannot be reached anonymously, and must not be the docker-compose ' +
        'dev placeholder',
    );
  }

  return errors;
};

const validateStorageEnv = (env: AppEnv) => {
  const errors: string[] = [];

  if (env.STORAGE_PROVIDER !== 'minio') {
    return errors;
  }

  if (!env.MINIO_ENDPOINT) {
    errors.push('MINIO_ENDPOINT must be configured when STORAGE_PROVIDER=minio');
  }
  if (!env.MINIO_ACCESS_KEY) {
    errors.push('MINIO_ACCESS_KEY must be configured when STORAGE_PROVIDER=minio');
  }
  if (!env.MINIO_SECRET_KEY) {
    errors.push('MINIO_SECRET_KEY must be configured when STORAGE_PROVIDER=minio');
  }
  if (!env.MINIO_BUCKET_NAME?.trim()) {
    errors.push('MINIO_BUCKET_NAME must be configured when STORAGE_PROVIDER=minio');
  }

  if (env.isProductionLike) {
    if (env.MINIO_ACCESS_KEY === 'minioadmin') {
      errors.push('MINIO_ACCESS_KEY must be replaced in production');
    }
    if (env.MINIO_SECRET_KEY === 'minioadmin12345678') {
      errors.push('MINIO_SECRET_KEY must be replaced in production');
    }
  }

  return errors;
};

export const loadAppEnv = (overrides?: NodeJS.ProcessEnv): AppEnv => {
  if (!cachedEnv) {
    loadEnv();
    const rawEnv = {
      ...process.env,
      ...overrides,
    };
    const parsed = envSchema.safeParse({
      ...rawEnv,
    });

    if (!parsed.success) {
      const message = parsed.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      throw new Error(`Failed to parse environment variables: ${message}`);
    }

    const productionErrors = validateProductionEnv(parsed.data);
    const storageErrors = validateStorageEnv(parsed.data);
    const allErrors = [...productionErrors, ...storageErrors];
    if (allErrors.length > 0) {
      throw new Error(`Invalid environment configuration: ${allErrors.join(', ')}`);
    }

    cachedEnv = parsed.data;
  }

  return cachedEnv;
};

export const resetAppEnvCache = () => {
  cachedEnv = undefined;
};

export const validateEnvForKnowledgeBase = (env: AppEnv): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!env.CHROMA_API_KEY || env.CHROMA_API_KEY.length < 10) {
    errors.push('CHROMA_API_KEY is invalid or too short');
  }

  if (!env.CHROMA_TENANT_ID || env.CHROMA_TENANT_ID.length < 10) {
    errors.push('CHROMA_TENANT_ID is invalid or too short');
  }

  if (env.CHROMA_API_KEY && !env.CHROMA_API_KEY.startsWith('ck-')) {
    errors.push('CHROMA_API_KEY should start with "ck-"');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

export const getEnvSummary = (env: AppEnv) => {
  return {
    environment: env.NODE_ENV,
    ports: {
      node: env.PORT,
      chroma: env.CHROMA_API_PORT,
    },
    services: {
      database: 'PostgreSQL',
      vectorDatabase: 'ChromaDB Cloud',
      aiModel: env.AI_API_MODEL,
      reportOcrProvider: env.OCR_PROVIDER,
      storageProvider: env.STORAGE_PROVIDER,
    },
    knowledgeBase: {
      database: env.CHROMA_DATABASE,
      tenantId: `${env.CHROMA_TENANT_ID?.substring(0, 8) || 'unknown'}...`,
      apiKeyConfigured: !!env.CHROMA_API_KEY,
      apiUrl: env.chromaApiBaseUrl,
    },
  };
};
