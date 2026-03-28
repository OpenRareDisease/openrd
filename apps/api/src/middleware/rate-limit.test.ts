import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { createRateLimitMiddleware } from './rate-limit.js';
import { AppError } from '../utils/app-error.js';

describe('createRateLimitMiddleware', () => {
  it('returns 429 after the configured request threshold', async () => {
    const middleware = createRateLimitMiddleware({
      keyPrefix: 'test',
      windowMs: 60_000,
      maxRequests: 2,
      message: 'too many requests',
    });
    const headers = new Map<string, string>();
    const req = { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as Request;
    const res = {
      setHeader: (key: string, value: string) => {
        headers.set(key, value);
      },
    } as unknown as Response;

    const invoke = async () =>
      new Promise<unknown>((resolve, reject) => {
        middleware(req, res, ((error?: unknown) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        }) as NextFunction);
      });

    await expect(invoke()).resolves.toBeUndefined();
    await expect(invoke()).resolves.toBeUndefined();
    await expect(invoke()).rejects.toMatchObject({
      statusCode: 429,
      message: 'too many requests',
    } satisfies Partial<AppError>);
    expect(headers.get('Retry-After')).toBeDefined();
  });
});
