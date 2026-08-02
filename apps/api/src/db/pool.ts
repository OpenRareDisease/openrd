import { Pool } from 'pg';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';

let pool: Pool | null = null;

/**
 * Resolve the pg `ssl` option from env. SSL is gated SOLELY on
 * DATABASE_SSL_ENABLED — deliberately NOT forced by NODE_ENV. The
 * production stack runs Postgres as a compose-internal service on the
 * docker network (traffic never leaves the host) and doesn't speak
 * SSL; forcing it there made `node dist/db/migrate.js` + the API pool
 * fail with "server does not support SSL connections". A remote /
 * managed DB MUST set DATABASE_SSL_ENABLED=true explicitly (see
 * .env.example + runbook §1). Single source of truth so the pool, the
 * migrate client, and the bootstrap admin client never diverge.
 */
export const resolvePgSsl = (env: AppEnv) =>
  env.DATABASE_SSL_ENABLED
    ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED }
    : undefined;

export const initPool = (env: AppEnv, logger: AppLogger) => {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.isTest ? 1 : env.DATABASE_POOL_MAX,
      ssl: resolvePgSsl(env),
      // Without this a checkout waits forever. pg-pool pushes the
      // waiter onto a queue with no timer when connectionTimeoutMillis
      // is 0 (its default), so a database that is up but saturated
      // turns into requests that never answer and never fail — the
      // client sees a spinner, the server sees nothing wrong, and
      // nothing recovers on its own.
      connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
      // Return idle connections rather than holding the pool at its
      // high-water mark forever.
      idleTimeoutMillis: 30_000,
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
