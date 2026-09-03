import { Request, Response, NextFunction } from 'express';
import { healthService } from '../services/health.js';

export class HealthController {
  async checkAll(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const checks = await healthService.checkAll();
      await Promise.all(checks.map((c) => healthService.recordHealthCheck(c)));
      
      const overallStatus = checks.every((c) => c.status === 'healthy') ? 'healthy' :
        checks.some((c) => c.status === 'unhealthy') ? 'unhealthy' : 'degraded';
      
      res.status(overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503).json({
        success: true,
        status: overallStatus,
        checks,
        timestamp: Date.now(),
      });
    } catch (error) {
      next(error);
    }
  }

  async checkOmniroute(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const check = await healthService.checkOmniroute();
      await healthService.recordHealthCheck(check);
      res.status(check.status === 'healthy' ? 200 : 503).json({
        success: true,
        data: check,
      });
    } catch (error) {
      next(error);
    }
  }

  async checkComfyUI(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const check = await healthService.checkComfyUI();
      await healthService.recordHealthCheck(check);
      res.status(check.status === 'healthy' ? 200 : 503).json({
        success: true,
        data: check,
      });
    } catch (error) {
      next(error);
    }
  }

  async getHealthHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { service, limit } = req.query;
      if (!service || !['omniroute', 'comfyui'].includes(service as string)) {
        res.status(400).json({ success: false, error: 'Invalid service parameter' });
        return;
      }
      const history = await healthService.getHealthHistory(service as 'omniroute' | 'comfyui', limit ? parseInt(limit as string, 10) : 100);
      res.json({ success: true, data: history });
    } catch (error) {
      next(error);
    }
  }

  async getLatestHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const latest = await healthService.getLatestHealth();
      res.json({ success: true, data: latest });
    } catch (error) {
      next(error);
    }
  }
}

export const healthController = new HealthController();