import type { ErrorRequestHandler, NextFunction } from 'express';
import { ZodError } from 'zod';
import type { AppLogger } from '../config/logger.js';
import { AppError } from '../utils/app-error.js';

interface ErrorHandlerOptions {
  logger: AppLogger;
}

//: AppError keys that are deliberately safe for client consumption.
//: Anything else stays in the server-side log only. Examples of
//: things callers SHOULDN'T see: `rateLimitKey: 'ai:ask'` (internal
//: routing label), future `sql: ...` (raw SQL) or `cause: ...`
//: (upstream stack). The audit's strict-review rule treats every
//: unfiltered field as "info that silently expands as features land".
const CLIENT_SAFE_DETAIL_KEYS = new Set<string>([
  'retryAfterSeconds',
  'lockedUntil',
  'waitSeconds',
  'code',
  'consent',
]);

const pickClientSafeDetails = (details: unknown): Record<string, unknown> | undefined => {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (CLIENT_SAFE_DETAIL_KEYS.has(key)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

export const errorHandler = ({ logger }: ErrorHandlerOptions): ErrorRequestHandler => {
  return (error, _req, res, _next: NextFunction) => {
    void _next;

    if (error instanceof AppError) {
      if (!error.isOperational) {
        logger.error({ error }, 'Operational error occurred');
      }
      const safeDetails = pickClientSafeDetails(error.details);
      res.status(error.statusCode).json({
        error: error.message,
        ...(safeDetails ? { details: safeDetails } : {}),
      });
      return;
    }

    if (error instanceof ZodError) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.flatten(),
      });
      return;
    }

    logger.error({ error }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  };
};
