// Service: authentication primitives — bcrypt password hashing and HS256 JWT
// signing/verification. Deliberately DB-free so it can be imported from anywhere
// (including db/index.ts for the bootstrap-admin seed) without cycles.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { AuthTokenPayload, SafeUser, UserRole } from '../types/index.js';

// '30m' | '12h' | '7d' | '3600' -> seconds (jsonwebtoken expects seconds/Strings).
function parseDuration(value: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: "${value}" (expected e.g. 30m, 12h, 7d or 3600)`);
  }
  const amount = parseInt(match[1], 10);
  const unit: string = match[2];
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 1;
  return amount * factor;
}

export class AuthService {
  // --- Passwords (bcrypt) ---
  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, config.auth.bcryptRounds);
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  // --- Tokens (HS256 JWT) ---
  // Claims carry the identity + role the API authorizes against. Tokens are
  // stateless: a role change/deactivation takes effect when the token expires
  // (default 24h) — clients simply log in again to pick up the new role.
  signToken(user: Pick<SafeUser, 'id' | 'email' | 'username' | 'role'>): string {
    const payload: AuthTokenPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role as UserRole,
    };
    return jwt.sign(payload, config.auth.jwtSecret, {
      expiresIn: parseDuration(config.auth.jwtExpiresIn),
    });
  }

  verifyToken(token: string): AuthTokenPayload {
    const decoded = jwt.verify(token, config.auth.jwtSecret);
    if (typeof decoded === 'string' || !decoded.sub || !decoded.role) {
      throw new jwt.JsonWebTokenError('Malformed token payload');
    }
    return decoded as unknown as AuthTokenPayload;
  }
}

export const authService = new AuthService();
// Standalone aliases of the stateless primitives. The methods above never touch
// `this`, so destructuring them is safe.
export const { hashPassword, verifyPassword, signToken, verifyToken } = authService;
