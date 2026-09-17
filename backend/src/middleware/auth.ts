import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken } from '../services/auth.js';
import { AppError } from './error.js';
import type { AuthTokenPayload, UserRole } from '../types/index.js';

// Augment Express requests with the authenticated principal. `authenticate`
// guarantees `req.user` is set for every downstream handler.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

// Requires a valid `Authorization: Bearer <token>` header. 401s are formatted by
// the shared error handler ({ success, error, code }) like every other failure.
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const match = header ? BEARER_PATTERN.exec(header.trim()) : null;
  if (!match) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    next(AppError.unauthorized('Authentication required: provide a Bearer token'));
    return;
  }

  try {
    req.user = verifyToken(match[1]);
    next();
  } catch (error) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    if (error instanceof jwt.TokenExpiredError) {
      next(AppError.unauthorized('Token expired'));
      return;
    }
    next(AppError.unauthorized('Invalid token'));
  }
}

// Role gate: use after `authenticate`. e.g. requireRole('admin').
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = getAuthUser(req);
    if (!roles.includes(user.role)) {
      next(AppError.forbidden(`Requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole('admin');

// Typed accessor for handlers behind `authenticate`.
export function getAuthUser(req: Request): AuthTokenPayload {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user;
}
