import pino from 'pino';
import type { AppEnv } from './env.js';

export const createLogger = (env: AppEnv) =>
  pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["set-cookie"]',
        'req.headers.x-api-key',
        'req.headers.proxy-authorization',
        'headers.authorization',
        'headers.cookie',
        'headers["set-cookie"]',
        'headers.x-api-key',
        'headers.proxy-authorization',
        'authorization',
        'cookie',
        'set-cookie',
        'x-api-key',
      ],
      censor: '[Redacted]',
    },
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
