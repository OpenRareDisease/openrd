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

//: Hard cap on the in-memory rate-limit map. Without it, an attacker
//: varying the keyResolver output (e.g. spoofing X-Forwarded-For
//: behind a trusted proxy, or hitting from many real IPs against the
//: /ask/progress endpoint at 30/min) can grow the map unboundedly
//: for the full window. At ~100k entries we evict the least-recently
//: written half — the kept entries are the ones still inside their
//: window. For production we should swap this to redis, but a bounded
//: in-memory map is the safe interim default.
const MAX_ENTRIES = 100_000;

const pruneExpired = (now: number) => {
  for (const [key, value] of stores.entries()) {
    if (value.resetAt <= now) {
      stores.delete(key);
    }
  }
  if (stores.size > MAX_ENTRIES) {
    // Drop the oldest half by insertion order. JS Maps iterate in
    // insertion order so the first half of `keys()` are the entries
    // that have been around the longest — those that aren't expired
    // yet are still the safest to drop because they'll just get
    // re-created on the next request (the limiter's behaviour for a
    // brand-new entry is to start fresh).
    const dropCount = Math.floor(stores.size / 2);
    let dropped = 0;
    for (const key of stores.keys()) {
      if (dropped >= dropCount) break;
      stores.delete(key);
      dropped += 1;
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
