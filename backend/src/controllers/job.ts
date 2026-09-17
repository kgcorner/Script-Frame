// Controller: job endpoints. Every access is authorized against the job's saved
// user_id (the creator recorded at creation time): a job is visible/manageable by
// its owner only, and foreign jobs are answered with 404 — indistinguishable from
// missing ones. Legacy rows created before user scoping (user_id NULL) are
// managed by admins so old data is not orphaned.
import { Request, Response, NextFunction } from 'express';
import { jobService } from '../services/job.js';
import { generatorService } from '../services/generator.js';
import { getAuthUser } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { z } from 'zod';
import type { Job, AuthTokenPayload, JobProgressUpdate, GeneratorArtifact, GeneratorJobStatusResult } from '../types/index.js';

const createJobSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  model: z.string().optional(),
  duration: z.number().int().positive().max(60).optional(),
  fps: z.number().int().positive().max(60).optional(),
  resolution: z.string().regex(/^\d+x\d+$/).optional(),
  workflowId: z.string().uuid().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const updateJobSchema = z.object({
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']).optional(),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

// The authorization anchor: the user_id saved on the job at creation time.
// - owner match -> access
// - legacy row (user_id NULL) -> admins only
// anything else -> 404 (never 403), so foreign job ids cannot be probed.
function assertJobAccess(job: Job, req: Request): void {
  const auth = getAuthUser(req);
  const isOwner = job.userId === auth.sub;
  const isLegacyForAdmin = job.userId === null && auth.role === 'admin';
  if (!isOwner && !isLegacyForAdmin) {
    throw AppError.notFound('Job not found');
  }
}

export class JobController {
  async createJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createJobSchema.parse(req.body);
      const auth = getAuthUser(req);
      const job = await jobService.createJob(input, auth.sub);
      res.status(201).json({ success: true, data: job });
    } catch (error) {
      next(error);
    }
  }

  async getJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const job = await jobService.getJob(id);
      if (!job) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      assertJobAccess(job, req);
      const assets = await jobService.getAssetsByJob(id);
      res.json({ success: true, data: { ...job, assets } });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/jobs/:id/status -> authorize against the saved user_id FIRST (so a
  // foreign request never triggers a ComfyUI reconcile), then reconcile and
  // report the artifact link.
  async getJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const existing = await jobService.getJob(id);
      if (!existing) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      assertJobAccess(existing, req);

      const job = (await generatorService.syncJobStatus(id)) ?? existing;
      const artifact = (job.output as { artifact?: GeneratorArtifact } | null)?.artifact ?? null;
      const data: GeneratorJobStatusResult = {
        jobId: job.id,
        userId: job.userId,
        projectId: job.projectId,
        status: job.status,
        comfyuiPromptId: job.comfyuiPromptId,
        error: job.error,
        artifact: artifact ? { ...artifact, url: `/artifact/${artifact.name}` } : null,
      };
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/jobs -> only the caller's own jobs. Admins additionally see legacy
  // rows (user_id NULL) so pre-scoping data is not orphaned.
  async getJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, projectId, limit, offset } = req.query;
      const auth = getAuthUser(req);
      const jobs = await jobService.getJobs({
        status: status as JobProgressUpdate['status'] | undefined,
        projectId: typeof projectId === 'string' ? projectId : undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
        userId: auth.sub,
        includeUnowned: auth.role === 'admin',
      });
      res.json({ success: true, data: jobs });
    } catch (error) {
      next(error);
    }
  }

  async updateJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const update = updateJobSchema.parse(req.body);
      const existing = await jobService.getJob(id);
      if (!existing) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      assertJobAccess(existing, req);

      const progressUpdate: JobProgressUpdate = {
        jobId: id,
        progress: update.progress ?? 0,
        status: update.status ?? 'pending',
        message: update.message,
        error: update.error,
      };
      const job = await jobService.updateJobStatus(id, progressUpdate);
      if (!job) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      res.json({ success: true, data: job });
    } catch (error) {
      next(error);
    }
  }

  async cancelJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const existing = await jobService.getJob(id);
      if (!existing) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      assertJobAccess(existing, req);

      await jobService.cancelJob(id);
      res.json({ success: true, message: 'Job cancelled' });
    } catch (error) {
      next(error);
    }
  }

  async deleteJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const existing = await jobService.getJob(id);
      if (!existing) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      assertJobAccess(existing, req);

      await jobService.deleteJob(id);
      res.json({ success: true, message: 'Job deleted' });
    } catch (error) {
      next(error);
    }
  }

  async processJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const existing = await jobService.getJob(id);
      if (!existing) {
        res.status(404).json({ success: false, error: 'Job not found' });
        return;
      }
      assertJobAccess(existing, req);

      await jobService.processVideoGeneration(id);
      res.json({ success: true, message: 'Job processing started' });
    } catch (error) {
      next(error);
    }
  }
}

export const jobController = new JobController();