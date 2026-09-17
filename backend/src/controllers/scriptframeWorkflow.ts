import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { scriptframeWorkflowService } from '../services/scriptframeWorkflow.js';

const nodeSchema = z.object({
  id: z.string(),
  type: z.enum(['worker', 'llm', 'comfyui-stack', 'comfyui-app', 'start', 'character-scene-creator']),
  title: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  inputs: z.array(z.any()).default([]),
  outputs: z.array(z.any()).default([]),
  data: z.record(z.string(), z.unknown()).optional(),
});

const linkSchema = z.object({
  id: z.number(),
  sourceNodeId: z.string(),
  sourceOutputName: z.string(),
  targetNodeId: z.string(),
  targetInputName: z.string(),
});

const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  nodes: z.array(nodeSchema).min(1, 'At least one node is required'),
  links: z.array(linkSchema).optional().default([]),
  nsfw: z.boolean().optional().default(false),
  // Maximum clip length for a single generated video (in seconds)
  maxClipLength: z.number().int().positive().max(86400).optional(), // Max 24 hours
  // Maximum timeout for video generation regardless of ComfyUI app (in seconds)
  maxTimeout: z.number().int().positive().max(604800).optional(), // Max 7 days
});

const updateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  nodes: z.array(nodeSchema).optional(),
  links: z.array(linkSchema).optional(),
  nsfw: z.boolean().optional(),
  // Maximum clip length for a single generated video (in seconds)
  maxClipLength: z.number().int().positive().max(86400).optional().nullable(),
  // Maximum timeout for video generation regardless of ComfyUI app (in seconds)
  maxTimeout: z.number().int().positive().max(604800).optional().nullable(),
});

const testConnectionSchema = z.object({
  nodeId: z.string(),
  type: z.enum(['llm', 'comfyui-stack', 'comfyui-app']),
  appId: z.string().optional(),
});

const testAllConnectionsSchema = z.object({
  targets: z.array(testConnectionSchema),
});

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export class ScriptFrameWorkflowController {
  async createWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createWorkflowSchema.parse(req.body);
      const workflow = await scriptframeWorkflowService.createWorkflow(input);
      res.status(201).json({ success: true, data: workflow });
    } catch (error) {
      next(error);
    }
  }

  async getWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const workflow = await scriptframeWorkflowService.getWorkflow(id);
      if (!workflow) {
        res.status(404).json({ success: false, error: 'ScriptFrame workflow not found' });
        return;
      }
      res.json({ success: true, data: workflow });
    } catch (error) {
      next(error);
    }
  }

  async getWorkflows(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { limit, offset } = req.query;
      const workflows = await scriptframeWorkflowService.getWorkflows({
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json({ success: true, data: workflows });
    } catch (error) {
      next(error);
    }
  }

  async updateWorkflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getIdParam(req);
      const updates = updateWorkflowSchema.parse(req.body);
      const workflow = await scriptframeWorkflowService.updateWorkflow(id, updates);
      if (!workflow) {
        res.status(404).json({ success: false, error: 'ScriptFrame workflow not found' });
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
      await scriptframeWorkflowService.deleteWorkflow(id);
      res.json({ success: true, message: 'ScriptFrame workflow deleted' });
    } catch (error) {
      next(error);
    }
  }

  async testConnection(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const target = testConnectionSchema.parse(req.body);
      const result = await scriptframeWorkflowService.testConnection(target);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async testAllConnections(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { targets } = testAllConnectionsSchema.parse(req.body);
      const results = await Promise.all(
        targets.map((t) => scriptframeWorkflowService.testConnection(t))
      );
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  }
}

export const scriptframeWorkflowController = new ScriptFrameWorkflowController();
