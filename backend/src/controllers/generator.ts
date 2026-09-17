// Controller: Generator endpoints (image-to-video, text-to-video, text-to-image,
// plus the workflow configuration used to drive their forms). Every generation is
// submitted on behalf of the JWT subject and scoped to one of THEIR projects.
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { generatorService } from '../services/generator.js';
import { getAuthUser } from '../middleware/auth.js';
import type { GeneratorJobType } from '../types/index.js';

// `workflow` selects the config entry; `projectId` scopes the job to one of the
// caller's projects (ownership is verified in the service); the remaining inputs
// are validated against that workflow's `inputs` definition inside the service
// (defaults are filled in there).
const generateSchema = z.object({
  workflow: z.string().min(1, 'workflow is required'),
  projectId: z.string().min(1, 'projectId is required'),
});

export class GeneratorController {
  // POST /api/generate-i2v -> queue the ComfyUI prompt and persist the job. The
  // `image` input accepts a base64 data URI or a stored artifact name; the bytes
  // are uploaded to ComfyUI by the service.
  async generateI2V(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.handleGenerate(req, res, next, 'video');
  }

  // POST /api/generate-t2v -> validate inputs, queue the ComfyUI prompt and persist the job.
  async generateT2V(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.handleGenerate(req, res, next, 'video');
  }

  // POST /api/generate-t2i -> validate inputs, queue the ComfyUI prompt and persist the job.
  async generateT2I(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.handleGenerate(req, res, next, 'image');
  }

  // GET /api/generator-config -> available workflows (name/description/inputs, no file).
  async getGeneratorConfig(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workflows = generatorService.getWorkflowsConfig();
      res.json({ success: true, data: workflows });
    } catch (error) {
      next(error);
    }
  }

  // Shared generation flow: the job type decides which media kind the finished
  // ComfyUI output is reconciled as ('video' for i2v/t2v, 'image' for t2i).
  private async handleGenerate(
    req: Request,
    res: Response,
    next: NextFunction,
    jobType: GeneratorJobType
  ): Promise<void> {
    try {
      const { workflow, projectId } = generateSchema.parse(req.body);
      const provided = { ...(req.body as Record<string, unknown>) };
      delete provided.workflow;
      delete provided.projectId;

      const auth = getAuthUser(req);
      const result = await generatorService.submitGeneration({
        workflow,
        provided,
        jobType,
        userId: auth.sub,
        projectId,
      });

      res.status(201).json({
        success: true,
        data: {
          jobId: result.jobId,
          projectId: result.projectId,
          status: result.status,
          workflow: result.workflow,
        },
      });
    } catch (error) {
      console.error('Error in handleGenerate:', error);
      next(error);
    }
  }
}

export const generatorController = new GeneratorController();