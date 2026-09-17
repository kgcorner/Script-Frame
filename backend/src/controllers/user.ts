// Controller: user management (CRUD) with role-based authorization.
//
// Route-level gates (routes/users.ts): every route requires `authenticate`;
// create/list/delete additionally require `requireAdmin`. Resource-level rules
// (self-or-admin, admin-only fields, password confirmation, self-lockout
// guards) are enforced here because they depend on the target id + caller.
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userService } from '../services/user.js';
import { authService } from '../services/auth.js';
import { getAuthUser } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one digit');

const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/, 'Username may only contain letters, digits, "_" and "-"');

// Admin-only create: explicit role + active flag allowed.
const createUserSchema = z.object({
  email: z.email('A valid email is required'),
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(['admin', 'user']).default('user'),
  isActive: z.boolean().default(true),
});

const updateUserSchema = z
  .object({
    email: z.email().optional(),
    username: usernameSchema.optional(),
    password: passwordSchema.optional(),
    currentPassword: z.string().min(1).optional(),
    role: z.enum(['admin', 'user']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

const listQuerySchema = z.object({
  search: z.string().min(1).optional(),
  role: z.enum(['admin', 'user']).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export class UserController {
  // POST /api/users — admin only.
  async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createUserSchema.parse(req.body);
      const user = await userService.createUser(input);
      res.status(201).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/users — admin only. Filterable + paginated.
  async getUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = listQuerySchema.parse(req.query);
      const { users, total } = await userService.getUsers(filters);
      res.json({
        success: true,
        data: users,
        pagination: { total, limit: filters.limit, offset: filters.offset },
      });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/users/:id — self or admin.
  async getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const auth = getAuthUser(req);
      if (auth.role !== 'admin' && auth.sub !== id) {
        throw AppError.forbidden('You can only view your own profile');
      }
      const user = await userService.getUserById(id);
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }

  // PATCH /api/users/:id — self or admin.
  // - Non-admins may only change their own username/password, and a password
  //   change requires the matching `currentPassword`.
  // - email/role/isActive are admin-only fields (403 for anyone else).
  // - Admins cannot demote/deactivate their own account (self-lockout guard).
  async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const updates = updateUserSchema.parse(req.body);
      const auth = getAuthUser(req);
      const isAdmin = auth.role === 'admin';
      const isSelf = auth.sub === id;

      if (!isAdmin && !isSelf) {
        throw AppError.forbidden('You can only update your own profile');
      }
      if (
        !isAdmin &&
        (updates.email !== undefined || updates.role !== undefined || updates.isActive !== undefined)
      ) {
        throw AppError.forbidden('Only admins can change email, role or active status');
      }

      const target = await userService.requireActiveUser(id);

      if (updates.password !== undefined && !isAdmin) {
        if (!updates.currentPassword) {
          throw AppError.badRequest('currentPassword is required to change your password');
        }
        const ok = await authService.verifyPassword(updates.currentPassword, target.passwordHash);
        if (!ok) {
          throw AppError.unauthorized('currentPassword is incorrect');
        }
      }

      if (isSelf && isAdmin && (updates.role !== undefined || updates.isActive === false)) {
        throw AppError.badRequest('You cannot change your own role or deactivate your own account');
      }

      const user = await userService.updateUser(id, updates);
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }

  // DELETE /api/users/:id — admin only; an admin cannot delete their own account
  // (keeps at least one admin reachable for user management).
  async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const auth = getAuthUser(req);
      if (auth.sub === id) {
        throw AppError.badRequest('You cannot delete your own account');
      }
      const deleted = await userService.deleteUser(id);
      if (!deleted) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      res.json({ success: true, message: 'User deleted' });
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();

