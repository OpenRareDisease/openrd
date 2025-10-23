import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { AppLogger } from '../config/logger.js';
import { AppError } from '../utils/app-error.js';

interface ErrorHandlerOptions {
  logger: AppLogger;
}

export const errorHandler = ({ logger }: ErrorHandlerOptions): ErrorRequestHandler => {
  return (error, _req, res) => {
    if (error instanceof AppError) {
      if (!error.isOperational) {
        logger.error({ error }, 'Operational error occurred');
      }
      res.status(error.statusCode).json({
        error: error.message,
        details: error.details,
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
