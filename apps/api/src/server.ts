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

/**
 * A passport share token is a bearer credential that travels in the URL
 * path (/s/passport/:token), so an unscrubbed access log is a second,
 * replayable copy of a patient's whole clinical record — diagnosis,
 * D4Z4 repeats, MRI summary — sitting in stdout and in whatever
 * collects it, for that sink's retention window. The feature is built
 * around that copy not existing: passport-share.service.ts opens by
 * stating the plaintext token is never stored or logged, `create()`
 * keeps it out of the audit row, and the pickup success line logs
 * { shareId } and not the code. pino-http was reinstating it at level
 * info on every open.
 *
 * The scrub runs on the SERIALIZED value rather than on the request:
 * pino.stdSerializers.req reads req.originalUrl in preference to
 * req.url, so rewriting req.url would miss it under Express. The route
 * prefix is kept so an operator can still see that a share was opened.
 *
 * /s/passport/pickup is left readable — it is a route, not a credential,
 * and the pickup code itself only ever arrives in a POST body.
 */
const SHARE_TOKEN_IN_PATH = /(\/s\/passport\/)(?!pickup(?:[/?#]|$))[^/?#]+/g;

const redactShareToken = (url: unknown): unknown =>
  typeof url === 'string' ? url.replace(SHARE_TOKEN_IN_PATH, `$1${REDACTED}`) : url;

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
          if (serialized && typeof serialized === 'object') {
            return {
              ...serialized,
              url: redactShareToken(serialized.url),
              ...('headers' in serialized
                ? {
                    headers: sanitizeHeaders(
                      serialized.headers as Record<string, unknown> | undefined,
                    ),
                  }
                : {}),
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
