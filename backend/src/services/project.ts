// Service: user-scoped project CRUD. Every read/write is scoped to the owner
// (the JWT subject) — projects belonging to other users are indistinguishable
// from nonexistent ones (404), so nothing about foreign projects leaks.
// Generation jobs will reference `projects.id` in a later step.
import { db, schema } from '../db/index.js';
import { and, count, desc, eq, like, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type {
  CreateProjectRequest,
  ProjectListFilters,
  SafeProject,
  UpdateProjectRequest,
} from '../types/index.js';
import type { Project } from '../db/schema.js';

export class ProjectService {
  async createProject(userId: string, input: CreateProjectRequest): Promise<SafeProject> {
    const id = uuidv4();
    const now = new Date().toISOString();
    await db.insert(schema.projects).values({
      id,
      userId,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      aspectRatio: (input.aspectRatio ?? '16:9').trim(),
      modelPreset: (input.modelPreset ?? 'default').trim(),
      status: input.status ?? 'active',
      thumbnailUrl: null,
      sceneCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    const [created] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    return this.toSafeProject(created!);
  }

  // Returns the project only when it exists AND belongs to `userId`; null
  // otherwise (callers answer 404 for both cases).
  async getProjectForUser(id: string, userId: string): Promise<SafeProject | null> {
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)));
    return project ? this.toSafeProject(project) : null;
  }

  async getProjectsForUser(
    userId: string,
    filters: ProjectListFilters
  ): Promise<{ projects: SafeProject[]; total: number }> {
    const conditions = [eq(schema.projects.userId, userId)];
    if (filters.search) {
      // SQLite has no ILIKE: lower both sides of the LIKE comparison.
      const pattern = `%${filters.search.toLowerCase()}%`;
      conditions.push(like(sql`lower(${schema.projects.name})`, pattern));
    }
    const where = and(...conditions);

    const listQuery = db.select().from(schema.projects).where(where);
    listQuery.orderBy(desc(schema.projects.createdAt));
    listQuery.limit(filters.limit);
    listQuery.offset(filters.offset);
    const rows = await listQuery;

    const [totals] = await db.select({ value: count() }).from(schema.projects).where(where);
    return { projects: rows.map((p) => this.toSafeProject(p)), total: totals?.value ?? 0 };
  }

  async updateProject(
    id: string,
    userId: string,
    updates: UpdateProjectRequest
  ): Promise<SafeProject | null> {
    const patch: Partial<typeof schema.projects.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (updates.name !== undefined) {
      patch.name = updates.name.trim();
    }
    if (updates.description !== undefined) {
      patch.description = updates.description;
    }
    if (updates.aspectRatio !== undefined) {
      patch.aspectRatio = updates.aspectRatio.trim();
    }
    if (updates.modelPreset !== undefined) {
      patch.modelPreset = updates.modelPreset.trim();
    }
    if (updates.status !== undefined) {
      patch.status = updates.status;
    }
    if (updates.thumbnailUrl !== undefined) {
      patch.thumbnailUrl = updates.thumbnailUrl;
    }
    if (updates.sceneCount !== undefined) {
      patch.sceneCount = updates.sceneCount;
    }

    // The ownership condition is part of the UPDATE itself: a foreign id is a no-op.
    await db
      .update(schema.projects)
      .set(patch)
      .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)));
    return this.getProjectForUser(id, userId);
  }

  async deleteProject(id: string, userId: string): Promise<boolean> {
    const deleted = await db
      .delete(schema.projects)
      .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
      .returning({ id: schema.projects.id });
    return deleted.length > 0;
  }

  toSafeProject(project: Project): SafeProject {
    return {
      id: project.id,
      userId: project.userId,
      name: project.name,
      description: project.description,
      aspectRatio: project.aspectRatio,
      modelPreset: project.modelPreset,
      status: project.status,
      thumbnailUrl: project.thumbnailUrl ?? null,
      sceneCount: project.sceneCount,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }
}

export const projectService = new ProjectService();
