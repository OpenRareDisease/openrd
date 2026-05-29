import { describe, expect, it } from 'vitest';

import { resolvePgSsl } from './pool.js';
import type { AppEnv } from '../config/env.js';

// resolvePgSsl only reads two fields; a partial env cast keeps the
// test focused on the SSL decision.
const envWith = (over: Partial<AppEnv>): AppEnv =>
  ({
    DATABASE_SSL_ENABLED: false,
    DATABASE_SSL_REJECT_UNAUTHORIZED: true,
    isProductionLike: false,
    ...over,
  }) as AppEnv;

describe('resolvePgSsl', () => {
  it('returns undefined when DATABASE_SSL_ENABLED is false — even under prod', () => {
    // The core contract of fix/db-ssl-explicit: SSL must NOT be forced
    // by NODE_ENV. The compose-internal Postgres speaks no SSL, and
    // forcing it broke api pool + migrate connect with "server does
    // not support SSL connections".
    expect(
      resolvePgSsl(envWith({ DATABASE_SSL_ENABLED: false, isProductionLike: true })),
    ).toBeUndefined();
  });

  it('returns an ssl object when DATABASE_SSL_ENABLED is true', () => {
    expect(
      resolvePgSsl(envWith({ DATABASE_SSL_ENABLED: true, DATABASE_SSL_REJECT_UNAUTHORIZED: true })),
    ).toEqual({ rejectUnauthorized: true });
  });

  it('passes rejectUnauthorized=false through (self-signed managed DB)', () => {
    expect(
      resolvePgSsl(
        envWith({ DATABASE_SSL_ENABLED: true, DATABASE_SSL_REJECT_UNAUTHORIZED: false }),
      ),
    ).toEqual({ rejectUnauthorized: false });
  });
});
