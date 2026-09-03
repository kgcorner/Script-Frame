import { Request, Response, NextFunction } from 'express';
import { jobService } from '../services/job.js';
import { z } from 'zod';
import type { JobProgressUpdate } from '../types/index.js';

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

export class JobController {
  async createJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createJobSchema.parse(req.body);
      const job = await jobService.createJob(input);
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
      const assets = await jobService.getAssetsByJob(id);
      res.json({ success: true, data: { ...job, assets } });
    } catch (error) {
      next(error);
    }
  }

  async getJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, limit, offset } = req.query;
      const jobs = await jobService.getJobs({
        status: status as JobProgressUpdate['status'] | undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
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
      await jobService.cancelJob(id);
      res.json({ success: true, message: 'Job cancelled' });
    } catch (error) {
      next(error);
    }
  }

  async deleteJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      await jobService.deleteJob(id);
      res.json({ success: true, message: 'Job deleted' });
    } catch (error) {
      next(error);
    }
  }

  async processJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      await jobService.processVideoGeneration(id);
      res.json({ success: true, message: 'Job processing started' });
    } catch (error) {
      next(error);
    }
  }
}

export const jobController = new JobController();