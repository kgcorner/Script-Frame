// Controller: authentication endpoints — public register/login + token-authenticated /me.
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.js';
import { userService } from '../services/user.js';
import { getAuthUser } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import type { AuthResponse } from '../types/index.js';

// Password policy: 8-128 chars with at least one letter and one digit.
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one digit');

const registerSchema = z.object({
  email: z.email('A valid email is required'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Username may only contain letters, digits, "_" and "-"'),
  password: passwordSchema,
});

const loginSchema = z
  .object({
    identifier: z.string().min(1).optional(),
    email: z.email().optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((d) => Boolean(d.identifier || d.email || d.username), {
    message: 'Provide identifier (email or username), or email/username',
  });

export class AuthController {
  // POST /api/auth/register — public. The first account on an empty instance
  // becomes admin (bootstrap); everyone else gets the 'user' role.
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = registerSchema.parse(req.body);
      const user = await userService.createUser(input);
      const token = authService.signToken(user);
      const data: AuthResponse = { user, token };
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  // POST /api/auth/login — public. Accepts { identifier } (email or username) or
  // explicit { email } / { username }. Always answers 401 'Invalid credentials'
  // on failure so the endpoint cannot be used to enumerate accounts.
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = loginSchema.parse(req.body);
      const identifier = (input.identifier ?? input.email ?? input.username)!;
      const user = await userService.verifyCredentials(identifier, input.password);
      if (!user) {
        throw AppError.unauthorized('Invalid credentials');
      }

      await userService.updateLastLogin(user.id);
      const token = authService.signToken(userService.toSafeUser(user));
      const data: AuthResponse = { user: userService.toSafeUser(user), token };
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/auth/me — current principal from the bearer token.
  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const claims = getAuthUser(req);
      const user = await userService.getUserById(claims.sub);
      if (!user) {
        throw AppError.unauthorized('Account no longer exists');
      }
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
