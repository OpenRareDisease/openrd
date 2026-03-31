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
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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

    OTP_PROVIDER: z.enum(['mock', 'tencent']).default('mock'),
    OTP_CODE_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
    OTP_RESEND_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
    OTP_MAX_SEND_PER_DAY: z.coerce.number().int().min(1).default(10),
    OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().min(1).default(5),
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
    isProduction: value.NODE_ENV === 'production',
    isTest: value.NODE_ENV === 'test',
    chromaApiUrl: `http://${value.CHROMA_API_HOST}:${value.CHROMA_API_PORT}`,
    chromaApiBaseUrl: `http://${value.CHROMA_API_HOST}:${value.CHROMA_API_PORT}/api`,
    kbServiceUrl:
      value.KB_SERVICE_URL || `http://${value.KB_SERVICE_HOST}:${value.KB_SERVICE_PORT}`,
  }));

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

const validateProductionEnv = (env: AppEnv) => {
  const errors: string[] = [];

  if (!env.isProduction) {
    return errors;
  }

  if (env.JWT_SECRET === 'change-me-super-secret') {
    errors.push('JWT_SECRET must be replaced in production');
  }
  if (env.OTP_HASH_SECRET === 'change-me-otp-secret') {
    errors.push('OTP_HASH_SECRET must be replaced in production');
  }
  if (env.DATABASE_URL === 'postgres://postgres:postgres@localhost:5432/fshd_openrd') {
    errors.push('DATABASE_URL must be replaced in production');
  }
  if (env.OTP_PROVIDER === 'mock') {
    errors.push('OTP_PROVIDER=mock is not allowed in production');
  }
  if (env.CORS_ORIGIN.trim() === '*' || !env.CORS_ORIGIN.trim()) {
    errors.push('CORS_ORIGIN must be explicitly configured in production');
  }
  if (env.OCR_PROVIDER === 'mock') {
    errors.push('OCR_PROVIDER=mock is not allowed in production');
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

  if (env.isProduction) {
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
