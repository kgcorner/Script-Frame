import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { comfyuiAppService } from '../services/comfyuiApp.js';

const primaryFieldSchema = z.object({
  nodeId: z.string(),
  inputName: z.string(),
  label: z.string(),
  aliasName: z.string().optional(), // User-defined alias for LLM to reference this field
  type: z.enum(['string', 'number', 'boolean', 'select', 'file', 'folder']),
  defaultValue: z.unknown().optional(),
  options: z.array(z.string()).optional(),
  tooltip: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  required: z.boolean(),
  order: z.number(),
});

const createAppSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  workflowId: z.string().min(1, 'Workflow ID is required'),
  workflowDefinition: z.record(z.string(), z.unknown()).optional(),
  primaryFields: z.array(primaryFieldSchema).min(1, 'At least one primary field is required'),
  defaultValues: z.record(z.string(), z.unknown()).optional(),
});

const updateAppSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  primaryFields: z.array(primaryFieldSchema).optional(),
  defaultValues: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

const executeAppSchema = z.object({
  primaryValues: z.record(z.string(), z.unknown()),
});

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export class ComfyUIAppController {
  async createApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createAppSchema.parse(req.body);

      if (!input.workflowDefinition && !input.workflowId) {
        res.status(400).json({ success: false, error: 'Workflow not found: provide a valid workflowId or workflowDefinition' });
        return;
      }

      const app = await comfyuiAppService.createApp(input);
      res.status(201).json({ success: true, data: app });
    } catch (error) {
      next(error);
    }
  }

  async getApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const app = await comfyuiAppService.getApp(id);
      if (!app) {
        res.status(404).json({ success: false, error: 'ComfyUI App not found' });
        return;
      }
      res.json({ success: true, data: app });
    } catch (error) {
      next(error);
    }
  }

  async getApps(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { isActive, workflowId, limit, offset } = req.query;
      const apps = await comfyuiAppService.getApps({
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
        workflowId: workflowId as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json({ success: true, data: apps });
    } catch (error) {
      next(error);
    }
  }

  async updateApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const updates = updateAppSchema.parse(req.body);
      const app = await comfyuiAppService.updateApp(id, updates);
      if (!app) {
        res.status(404).json({ success: false, error: 'ComfyUI App not found' });
        return;
      }
      res.json({ success: true, data: app });
    } catch (error) {
      next(error);
    }
  }

  async deleteApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      await comfyuiAppService.deleteApp(id);
      res.json({ success: true, message: 'ComfyUI App deleted' });
    } catch (error) {
      next(error);
    }
  }

  async executeApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const input = executeAppSchema.parse(req.body);
      
      // Validate primary values
      const app = await comfyuiAppService.getApp(id);
      if (!app) {
        res.status(404).json({ success: false, error: 'ComfyUI App not found' });
        return;
      }
      
      const validation = comfyuiAppService.validatePrimaryValues(
        app.primaryFields as any,
        input.primaryValues
      );
      
      if (!validation.valid) {
        res.status(400).json({ success: false, error: 'Validation failed', details: validation.errors });
        return;
      }

      const result = await comfyuiAppService.executeApp(id, input);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getAppWorkflowInputs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const inputs = await comfyuiAppService.getAppWorkflowInputs(id);
      res.json({ success: true, data: inputs });
    } catch (error) {
      next(error);
    }
  }
}

export const comfyuiAppController = new ComfyUIAppController();