import { Request, Response, NextFunction } from 'express';
import { omnirouteService } from '../services/omniroute.js';
import { comfyuiService } from '../services/comfyui.js';
import { z } from 'zod';

const generateSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  workflowId: z.string().uuid().optional(),
});

function getIdParam(req: Request, param: string): string {
  const value = req.params[param];
  return Array.isArray(value) ? value[0] : value;
}

export class ServicesController {
  async omnirouteGenerate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = generateSchema.parse(req.body);
      const result = await omnirouteService.generate(input);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async omnirouteStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = getIdParam(req, 'jobId');
      const result = await omnirouteService.getStatus(jobId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async omnirouteCancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = getIdParam(req, 'jobId');
      await omnirouteService.cancel(jobId);
      res.json({ success: true, message: 'Job cancelled' });
    } catch (error) {
      next(error);
    }
  }

  async omnirouteModels(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const models = await omnirouteService.getModels();
      res.json({ success: true, data: models });
    } catch (error) {
      next(error);
    }
  }

  async comfyuiQueuePrompt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workflow, clientId } = req.body;
      const result = await comfyuiService.queuePrompt(workflow, clientId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async comfyuiHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const promptId = getIdParam(req, 'promptId');
      const result = await comfyuiService.getHistory(promptId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async comfyuiQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await comfyuiService.getQueueStatus();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async comfyuiStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await comfyuiService.getSystemStats();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async comfyuiInterrupt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await comfyuiService.interrupt();
      res.json({ success: true, message: 'Interrupted' });
    } catch (error) {
      next(error);
    }
  }

  async comfyuiFreeMemory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { unloadModels } = req.body;
      await comfyuiService.freeMemory(unloadModels);
      res.json({ success: true, message: 'Memory freed' });
    } catch (error) {
      next(error);
    }
  }

  async comfyuiModels(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const models = await comfyuiService.getModels();
      res.json({ success: true, data: models });
    } catch (error) {
      next(error);
    }
  }

  async comfyuiEmbeddings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const embeddings = await comfyuiService.getEmbeddings();
      res.json({ success: true, data: embeddings });
    } catch (error) {
      next(error);
    }
  }

  async comfyuiObjectInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const objectInfo = await comfyuiService.getObjectInfo();
      res.json({ success: true, data: objectInfo });
    } catch (error) {
      next(error);
    }
  }
}

export const servicesController = new ServicesController();