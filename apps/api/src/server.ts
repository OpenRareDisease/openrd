import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import type { AppEnv } from './config/env';
import type { AppLogger } from './config/logger';
import { initPool } from './db/pool';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { registerRoutes } from './routes';

interface CreateServerOptions {
  env: AppEnv;
  logger: AppLogger;
}

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
  app.use(pinoHttp({ logger }));

  initPool(env, logger);
  registerRoutes(app, { env, logger });

  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));

  return app;
};
