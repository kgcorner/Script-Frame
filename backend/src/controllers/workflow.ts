import { Request, Response, NextFunction } from 'express';
import { workflowService } from '../services/workflow.js';
import { comfyuiService, type ComfyUISavedWorkflow } from '../services/comfyui.js';
import { z } from 'zod';

const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  definition: z.record(z.string(), z.unknown()),
  version: z.number().int().positive().default(1),
  isActive: z.boolean().default(true),
});

const updateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  definition: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export class WorkflowController {
  async createWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createWorkflowSchema.parse(req.body);
      const workflow = await workflowService.createWorkflow(input);
      res.status(201).json({ success: true, data: workflow });
    } catch (error) {
      next(error);
    }
  }

  async getWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const workflow = await workflowService.getWorkflow(id);
      if (!workflow) {
        res.status(404).json({ success: false, error: 'Workflow not found' });
        return;
      }
      res.json({ success: true, data: workflow });
    } catch (error) {
      next(error);
    }
  }

  async getWorkflows(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { isActive, limit, offset } = req.query;
      const workflows = await workflowService.getWorkflows({
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json({ success: true, data: workflows });
    } catch (error) {
      next(error);
    }
  }

  async getComfyUISavedWorkflows(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workflows = await comfyuiService.getSavedWorkflows();
      res.json({ success: true, data: workflows });
    } catch (error) {
      next(error);
    }
  }

  async getComfyUIWorkflowHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workflows = await comfyuiService.getWorkflowHistory();
      res.json({ success: true, data: workflows });
    } catch (error) {
      next(error);
    }
  }

  async updateWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const updates = updateWorkflowSchema.parse(req.body);
      const workflow = await workflowService.updateWorkflow(id, updates);
      if (!workflow) {
        res.status(404).json({ success: false, error: 'Workflow not found' });
        return;
      }
      res.json({ success: true, data: workflow });
    } catch (error) {
      next(error);
    }
  }

  async deleteWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      await workflowService.deleteWorkflow(id);
      res.json({ success: true, message: 'Workflow deleted' });
    } catch (error) {
      next(error);
    }
  }

  async activateWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const workflow = await workflowService.activateWorkflow(id);
      if (!workflow) {
        res.status(404).json({ success: false, error: 'Workflow not found' });
        return;
      }
      res.json({ success: true, data: workflow });
    } catch (error) {
      next(error);
    }
  }

  async deactivateWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const workflow = await workflowService.deactivateWorkflow(id);
      if (!workflow) {
        res.status(404).json({ success: false, error: 'Workflow not found' });
        return;
      }
      res.json({ success: true, data: workflow });
    } catch (error) {
      next(error);
    }
  }
}

export const workflowController = new WorkflowController();