import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
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
    AI_API_BASE_URL: z.string().url().default('https://api.siliconflow.cn/v1'),
    AI_API_MODEL: z.string().default('deepseek-ai/DeepSeek-V3'),
    AI_API_TIMEOUT: z.coerce.number().int().positive().default(30000)
  })
  .transform((value) => ({
    ...value,
    isProduction: value.NODE_ENV === 'production',
    isTest: value.NODE_ENV === 'test'
  }));

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export const loadAppEnv = (overrides?: NodeJS.ProcessEnv): AppEnv => {
  if (!cachedEnv) {
    loadEnv();
    const parsed = envSchema.safeParse({
      ...process.env,
      ...overrides
    });

    if (!parsed.success) {
      const message = parsed.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`).join(', ');
      throw new Error(`Failed to parse environment variables: ${message}`);
    }

    cachedEnv = parsed.data;
  }

  return cachedEnv;
};

export const resetAppEnvCache = () => {
  cachedEnv = undefined;
};