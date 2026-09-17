import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, message, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(401, message, 'UNAUTHORIZED');
  }

  static forbidden(message = 'Insufficient permissions') {
    return new AppError(403, message, 'FORBIDDEN');
  }

  static notFound(message: string) {
    return new AppError(404, message, 'NOT_FOUND');
  }

  static conflict(message: string, details?: unknown) {
    return new AppError(409, message, 'CONFLICT', details);
  }

  static internal(message: string, details?: unknown) {
    return new AppError(500, message, 'INTERNAL_ERROR', details);
  }

  static serviceUnavailable(message: string, details?: unknown) {
    return new AppError(503, message, 'SERVICE_UNAVAILABLE', details);
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Error:', err);

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: 'Validation Error',
      code: 'VALIDATION_ERROR',
      details: err.issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      details: err.details,
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    code: 'NOT_FOUND',
  });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}