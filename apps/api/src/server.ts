import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppEnv } from './config/env.js';
import type { AppLogger } from './config/logger.js';
import { initPool } from './db/pool.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { registerRoutes } from './routes/index.js';

interface CreateServerOptions {
  env: AppEnv;
  logger: AppLogger;
}

const REDACTED = '[Redacted]';

const sanitizeHeaders = (headers: Record<string, unknown> | undefined) => {
  if (!headers) {
    return headers;
  }

  const clone: Record<string, unknown> = { ...headers };
  for (const key of ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization']) {
    if (key in clone) {
      clone[key] = REDACTED;
    }
  }
  return clone;
};

export const createServer = ({ env, logger }: CreateServerOptions) => {
  const app = express();

  // Trust the reverse proxy so `req.ip` reflects the real client
  // rather than the proxy hop. Without this, the IP-keyed rate
  // limiter (rate-limit.ts) degenerates to a single global bucket
  // behind any nginx / ingress / LB — one noisy user trips the AI
  // rate limit for everyone and OTP / login throttles become useless.
  // The hop count (1) matches the standard "single front-proxy"
  // topology; raise via TRUST_PROXY env when fronting multiple
  // hops, but keep the explicit default visible in code.
  app.set('trust proxy', 1);

  app.use(helmet());

  const allowedOrigins = env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  // `'*'` + `credentials: true` is the textbook misconfig: even when
  // production env validation blocks the wildcard, the dev branch
  // would otherwise reflect every Origin AND ship Access-Control-
  // Allow-Credentials: true, which `origin: true` does turn into a
  // credentialed open CORS. Force credentials off for the wildcard
  // branch so the misconfig can never become exploitable even in dev.
  const corsOptions =
    env.CORS_ORIGIN === '*'
      ? { origin: true, credentials: false }
      : { origin: allowedOrigins, credentials: true };

  app.use(cors(corsOptions));
  // Explicit 256 KB body limit. Express defaults to 100 KB, but a
  // future caller widening this somewhere else would silently move
  // the ceiling. Pin it here for visibility — 256 KB is the
  // realistic upper bound for /ai/ask question + queries payloads.
  app.use(express.json({ limit: '256kb' }));
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: (req) => {
          const serialized = pino.stdSerializers.req(req);
          if (serialized && typeof serialized === 'object' && 'headers' in serialized) {
            return {
              ...serialized,
              headers: sanitizeHeaders(serialized.headers as Record<string, unknown> | undefined),
            };
          }
          return serialized;
        },
        res: (res) => {
          const serialized = pino.stdSerializers.res(res);
          if (serialized && typeof serialized === 'object' && 'headers' in serialized) {
            return {
              ...serialized,
              headers: sanitizeHeaders(serialized.headers as Record<string, unknown> | undefined),
            };
          }
          return serialized;
        },
      },
    }),
  );

  initPool(env, logger);
  registerRoutes(app, { env, logger });

  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));

  return app;
};
