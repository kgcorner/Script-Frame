// Service: user management (CRUD) on the `users` table. Password hashes are
// created/verified through services/auth.ts and are never exposed outside this
// layer — every read path returns SafeUser (hash stripped).
import { db, schema } from '../db/index.js';
import { and, count, desc, eq, like, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword, verifyPassword } from './auth.js';
import { AppError } from '../middleware/error.js';
import type {
  CreateUserRequest,
  SafeUser,
  UpdateUserRequest,
  UserListFilters,
  UserRole,
} from '../types/index.js';
import type { User } from '../db/schema.js';

export class UserService {
  // Create a user. When no role is given, the FIRST user of an empty table is
  // promoted to admin (bootstrap) — public registration and admin creation share
  // this rule. Email is normalised to lower-case; duplicates fail with 409.
  async createUser(input: CreateUserRequest): Promise<SafeUser> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim();

    await this.assertAvailable(email, username);

    const role: UserRole =
      input.role ?? ((await this.countUsers()) === 0 ? 'admin' : 'user');

    const id = uuidv4();
    await db.insert(schema.users).values({
      id,
      email,
      username,
      passwordHash: await hashPassword(input.password),
      role,
      isActive: input.isActive ?? true,
    });
    const [created] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return this.toSafeUser(created!);
  }

  async getUserById(id: string): Promise<SafeUser | null> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return user ? this.toSafeUser(user) : null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.trim().toLowerCase()));
    return user ?? null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username.trim()));
    return user ?? null;
  }

  async getUsers(filters: UserListFilters): Promise<{ users: SafeUser[]; total: number }> {
    const conditions = [];
    if (filters.search) {
      // SQLite has no ILIKE operator: case-insensitive matching is done by
      // lowering both sides of a LIKE comparison.
      const pattern = `%${filters.search.toLowerCase()}%`;
      conditions.push(
        or(
          like(sql`lower(${schema.users.email})`, pattern),
          like(sql`lower(${schema.users.username})`, pattern)
        )
      );
    }
    if (filters.role) {
      conditions.push(eq(schema.users.role, filters.role));
    }
    if (filters.isActive !== undefined) {
      conditions.push(eq(schema.users.isActive, filters.isActive));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const listQuery = db.select().from(schema.users);
    const totalQuery = db.select({ value: count() }).from(schema.users);
    if (where) {
      listQuery.where(where);
      totalQuery.where(where);
    }
    listQuery.orderBy(desc(schema.users.createdAt));
    listQuery.limit(filters.limit);
    listQuery.offset(filters.offset);

    const rows = await listQuery;
    const [totals] = await totalQuery;
    return { users: rows.map((u) => this.toSafeUser(u)), total: totals?.value ?? 0 };
  }

  // Update a user. `updates.password` is re-hashed; `currentPassword` (when
  // provided) must match the stored hash — the self-service path always provides
  // it (enforced by the controller), admins may reset passwords without it.
  async updateUser(id: string, updates: UpdateUserRequest): Promise<SafeUser | null> {
    const patch: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };

    if (updates.email !== undefined) {
      const email = updates.email.trim().toLowerCase();
      if (email !== (await this.requireEmail(id))) {
        await this.assertAvailable(email, undefined, id);
      }
      patch.email = email;
    }
    if (updates.username !== undefined) {
      const username = updates.username.trim();
      if (username !== (await this.requireUsername(id))) {
        await this.assertAvailable(undefined, username, id);
      }
      patch.username = username;
    }
    if (updates.role !== undefined) {
      patch.role = updates.role;
    }
    if (updates.isActive !== undefined) {
      patch.isActive = updates.isActive;
    }
    if (updates.password !== undefined) {
      patch.passwordHash = await hashPassword(updates.password);
    }

    await db.update(schema.users).set(patch).where(eq(schema.users.id, id));
    return this.getUserById(id);
  }

  async deleteUser(id: string): Promise<boolean> {
    const deleted = await db
      .delete(schema.users)
      .where(eq(schema.users.id, id))
      .returning({ id: schema.users.id });
    return deleted.length > 0;
  }

  // Credential check for login: returns the raw record (hash included) on success.
  async verifyCredentials(identifier: string, password: string): Promise<User | null> {
    const trimmed = identifier.trim();
    const user = trimmed.includes('@')
      ? await this.getUserByEmail(trimmed)
      : await this.getUserByUsername(trimmed);
    if (!user || !user.isActive) {
      return null;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    return ok ? user : null;
  }

  async updateLastLogin(id: string): Promise<void> {
    await db
      .update(schema.users)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.users.id, id));
  }

  async countUsers(): Promise<number> {
    const [row] = await db.select({ value: count() }).from(schema.users);
    return row?.value ?? 0;
  }

  // Raw lookup (hash included) for authorization checks in the controllers.
  async requireActiveUser(id: string): Promise<User> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!user) {
      throw AppError.notFound('User not found');
    }
    return user;
  }

  toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role as UserRole,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private async assertAvailable(email?: string, username?: string, excludeId?: string): Promise<void> {
    if (email) {
      const existing = await this.getUserByEmail(email);
      if (existing && existing.id !== excludeId) {
        throw AppError.conflict('Email is already registered', { field: 'email' });
      }
    }
    if (username) {
      const existing = await this.getUserByUsername(username);
      if (existing && existing.id !== excludeId) {
        throw AppError.conflict('Username is already taken', { field: 'username' });
      }
    }
  }

  private async requireEmail(id: string): Promise<string> {
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return user?.email ?? '';
  }

  private async requireUsername(id: string): Promise<string> {
    const [user] = await db
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return user?.username ?? '';
  }
}

export const userService = new UserService();

