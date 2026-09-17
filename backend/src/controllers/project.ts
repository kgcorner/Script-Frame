// Controller: project CRUD. All handlers act on behalf of the JWT subject
// (req.user.sub) — a user can only ever see and modify their own projects;
// foreign projects are answered with 404 so their existence never leaks.
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { projectService } from '../services/project.js';
import { userService } from '../services/user.js';
import { getAuthUser } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Project name is required')
    .max(120, 'Project name must be at most 120 characters'),
  description: z
    .string()
    .max(2000, 'Description must be at most 2000 characters')
    .nullish(),
  aspectRatio: z
    .string()
    .trim()
    .min(1, 'Aspect ratio cannot be empty')
    .max(32, 'Aspect ratio must be at most 32 characters')
    .optional(),
  modelPreset: z
    .string()
    .trim()
    .min(1, 'Model preset cannot be empty')
    .max(120, 'Model preset must be at most 120 characters')
    .optional(),
  status: z.enum(['active', 'draft', 'completed']).optional(),
});

const updateProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Project name cannot be empty')
      .max(120, 'Project name must be at most 120 characters')
      .optional(),
    description: z
      .string()
      .max(2000, 'Description must be at most 2000 characters')
      .nullish(),
    aspectRatio: z
      .string()
      .trim()
      .min(1, 'Aspect ratio cannot be empty')
      .max(32, 'Aspect ratio must be at most 32 characters')
      .optional(),
    modelPreset: z
      .string()
      .trim()
      .min(1, 'Model preset cannot be empty')
      .max(120, 'Model preset must be at most 120 characters')
      .optional(),
    status: z.enum(['active', 'draft', 'completed']).optional(),
    thumbnailUrl: z.string().max(1024).optional(),
    sceneCount: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.description !== undefined ||
      d.aspectRatio !== undefined ||
      d.modelPreset !== undefined ||
      d.status !== undefined ||
      d.thumbnailUrl !== undefined ||
      d.sceneCount !== undefined,
    { message: 'At least one field is required' },
  );

const listQuerySchema = z.object({
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export class ProjectController {
  // POST /api/projects — create a project owned by the authenticated user.
  async createProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createProjectSchema.parse(req.body);
      const auth = getAuthUser(req);

      // Stateless JWT trade-off guard: the token subject must still exist,
      // otherwise the users FK would surface as an ugly 500.
      const owner = await userService.getUserById(auth.sub);
      if (!owner) {
        throw AppError.unauthorized('Account no longer exists');
      }

      const project = await projectService.createProject(auth.sub, input);
      res.status(201).json({ success: true, data: project });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/projects — list the authenticated user's own projects.
  async getProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = listQuerySchema.parse(req.query);
      const auth = getAuthUser(req);
      const { projects, total } = await projectService.getProjectsForUser(auth.sub, filters);
      res.json({
        success: true,
        data: projects,
        pagination: { total, limit: filters.limit, offset: filters.offset },
      });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/projects/:id — owner only (404 for foreign or missing ids).
  async getProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const auth = getAuthUser(req);
      const project = await projectService.getProjectForUser(id, auth.sub);
      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      res.json({ success: true, data: project });
    } catch (error) {
      next(error);
    }
  }

  // PATCH /api/projects/:id — owner only.
  async updateProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const updates = updateProjectSchema.parse(req.body);
      const auth = getAuthUser(req);
      const project = await projectService.updateProject(id, auth.sub, updates);
      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      res.json({ success: true, data: project });
    } catch (error) {
      next(error);
    }
  }

  // DELETE /api/projects/:id — owner only.
  async deleteProject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const auth = getAuthUser(req);
      const deleted = await projectService.deleteProject(id, auth.sub);
      if (!deleted) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      res.json({ success: true, message: 'Project deleted' });
    } catch (error) {
      next(error);
    }
  }
}

export const projectController = new ProjectController();
