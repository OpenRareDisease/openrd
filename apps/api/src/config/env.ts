import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z
      .string()
      .min(1)
      .default('postgres://postgres:postgres@localhost:5432/fshd_openrd'),
    JWT_SECRET: z
      .string()
      .min(16, 'JWT_SECRET must be at least 16 characters long')
      .default('change-me-super-secret'),
    JWT_EXPIRES_IN: z.string().default('7d'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(6).max(14).default(10),
    CORS_ORIGIN: z.string().default('*'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

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

    REPORT_MANAGER_OCR_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    REPORT_MANAGER_OCR_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    REPORT_MANAGER_OCR_USER_ID: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce.number().int().positive().optional(),
    ),

    CHROMA_API_KEY: z.string().min(1).optional(),
    CHROMA_TENANT_ID: z.string().min(1).optional(),
    CHROMA_DATABASE: z.string().default('FSHD'),
    CHROMA_COLLECTION: z.string().default('fshd_knowledge_base'),
    CHROMA_API_PORT: z.coerce.number().int().positive().default(5000),
    CHROMA_API_HOST: z.string().default('localhost'),
  })
  .transform((value) => ({
    ...value,
    isProduction: value.NODE_ENV === 'production',
    isTest: value.NODE_ENV === 'test',
    chromaApiUrl: `http://${value.CHROMA_API_HOST}:${value.CHROMA_API_PORT}`,
    chromaApiBaseUrl: `http://${value.CHROMA_API_HOST}:${value.CHROMA_API_PORT}/api`,
  }));

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export const loadAppEnv = (overrides?: NodeJS.ProcessEnv): AppEnv => {
  if (!cachedEnv) {
    loadEnv();
    const parsed = envSchema.safeParse({
      ...process.env,
      ...overrides,
    });

    if (!parsed.success) {
      const message = parsed.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      throw new Error(`Failed to parse environment variables: ${message}`);
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
    },
    knowledgeBase: {
      database: env.CHROMA_DATABASE,
      tenantId: `${env.CHROMA_TENANT_ID?.substring(0, 8) || 'unknown'}...`,
      apiKeyConfigured: !!env.CHROMA_API_KEY,
      apiUrl: env.chromaApiBaseUrl,
    },
  };
};
