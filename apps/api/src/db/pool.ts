import { Pool } from 'pg';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';

let pool: Pool | null = null;

export const initPool = (env: AppEnv, logger: AppLogger) => {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.isTest ? 1 : undefined,
      ssl:
        env.DATABASE_SSL_ENABLED || env.isProduction
          ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED }
          : undefined,
    });

    pool.on('error', (error) => {
      logger.error({ error }, 'Unexpected database error');
    });

    logger.info('PostgreSQL connection pool initialized');
  }

  return pool;
};

export const getPool = () => {
  if (!pool) {
    throw new Error('Database pool has not been initialized');
  }

  return pool;
};
