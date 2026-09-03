import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { comfyuiAppService } from '../services/comfyuiApp.js';

const createStackSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  baseUrl: z.string().url().optional().or(z.string().min(1).optional()),
  port: z.number().int().positive().optional(),
  appIds: z.array(z.string()).optional(),
});

const updateStackSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  baseUrl: z.string().optional(),
  port: z.number().int().positive().optional(),
  appIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export class ComfyUIStackController {
  async createStack(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createStackSchema.parse(req.body);
      const stack = await comfyuiAppService.createStack(input);
      res.status(201).json({ success: true, data: stack });
    } catch (error) {
      next(error);
    }
  }

  async getStack(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const stack = await comfyuiAppService.getStack(id);
      if (!stack) {
        res.status(404).json({ success: false, error: 'ComfyUI stack not found' });
        return;
      }
      res.json({ success: true, data: stack });
    } catch (error) {
      next(error);
    }
  }

  async getStacks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { isActive, limit, offset } = req.query;
      const stacks = await comfyuiAppService.getStacks({
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json({ success: true, data: stacks });
    } catch (error) {
      next(error);
    }
  }

  async updateStack(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const updates = updateStackSchema.parse(req.body);
      const stack = await comfyuiAppService.updateStack(id, updates);
      if (!stack) {
        res.status(404).json({ success: false, error: 'ComfyUI stack not found' });
        return;
      }
      res.json({ success: true, data: stack });
    } catch (error) {
      next(error);
    }
  }

  async deleteStack(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      await comfyuiAppService.deleteStack(id);
      res.json({ success: true, message: 'ComfyUI stack deleted' });
    } catch (error) {
      next(error);
    }
  }

  async testStack(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const result = await comfyuiAppService.stackHealthCheck(id);
      res.json({ success: result.healthy, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const comfyuiStacksController = new ComfyUIStackController();