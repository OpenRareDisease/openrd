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
      // Ceiling per PROCESS. The number that has to hold is
      // (api replicas x DATABASE_POOL_MAX) + migrate's own single
      // connection + the kb-service pool + whatever an operator has
      // open in psql, all under Postgres's max_connections. The compose
      // stack runs one api replica against a stock postgres:16 image,
      // whose max_connections is 100, so the default 10 leaves an order
      // of magnitude of headroom — but the arithmetic stops being
      // obvious the moment someone scales `api` horizontally, which is
      // exactly when the failure (「remaining connection slots are
      // reserved for non-replication superuser connections」 at boot,
      // on the instance that happened to start last) is hardest to
      // read. Raise max_connections in the same change as the replica
      // count, never after.
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
