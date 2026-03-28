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

  app.use(helmet());

  const allowedOrigins = env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const corsOptions =
    env.CORS_ORIGIN === '*'
      ? { origin: true, credentials: true }
      : { origin: allowedOrigins, credentials: true };

  app.use(cors(corsOptions));
  app.use(express.json());
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
