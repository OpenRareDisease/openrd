import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';
import { AppError } from '../utils/app-error.js';

interface JwtPayload {
  sub: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  role: string;
  token: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

export const requireAuth = (env: AppEnv, logger: AppLogger): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      return next(new AppError('Authentication required', 401));
    }

    const token = header.slice(7).trim();

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

      if (!decoded?.sub) {
        throw new AppError('Invalid token payload', 401);
      }

      (req as AuthenticatedRequest).user = {
        id: decoded.sub,
        role: decoded.role,
        token,
      };

      return next();
    } catch (error) {
      logger.warn({ error }, 'Failed to authenticate request');
      return next(new AppError('Invalid or expired token', 401));
    }
  };
};
