import pino from 'pino';
import type { AppEnv } from './env.js';

export const createLogger = (env: AppEnv) =>
  pino({
    level: env.LOG_LEVEL,
    transport: env.isProduction
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
          },
        },
  });

export type AppLogger = ReturnType<typeof createLogger>;
