import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../utils/app-error.js';

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message: string;
  keyPrefix: string;
  keyResolver?: (req: Request) => string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const stores = new Map<string, RateLimitEntry>();

const pruneExpired = (now: number) => {
  for (const [key, value] of stores.entries()) {
    if (value.resetAt <= now) {
      stores.delete(key);
    }
  }
};

export const createRateLimitMiddleware = (options: RateLimitOptions): RequestHandler => {
  const keyResolver =
    options.keyResolver ?? ((req: Request) => req.ip || req.socket.remoteAddress || 'unknown');

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    pruneExpired(now);

    const key = `${options.keyPrefix}:${keyResolver(req)}`;
    const existing = stores.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + options.windowMs;
      stores.set(key, { count: 1, resetAt });
      res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(options.maxRequests - 1, 0)));
      res.setHeader('X-RateLimit-Reset', new Date(resetAt).toISOString());
      return next();
    }

    if (existing.count >= options.maxRequests) {
      const retryAfterSeconds = Math.max(Math.ceil((existing.resetAt - now) / 1000), 1);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return next(
        new AppError(options.message, 429, {
          retryAfterSeconds,
          rateLimitKey: options.keyPrefix,
        }),
      );
    }

    existing.count += 1;
    stores.set(key, existing);

    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(options.maxRequests - existing.count, 0)),
    );
    res.setHeader('X-RateLimit-Reset', new Date(existing.resetAt).toISOString());

    return next();
  };
};
