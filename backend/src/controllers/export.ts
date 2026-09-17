// Controller: video export endpoint. Takes an ordered list of stored video artifact
// names, creates the export job ('not_started') and starts the background stitch.
// The stitched video is delivered via GET /api/jobs/:id/status (artifact name + url)
// and GET /artifact/:name (download).
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { exportService } from '../services/export.js';
import { getAuthUser } from '../middleware/auth.js';

const exportVideoSchema = z.object({
  videos: z
    .array(z.string().min(1, 'video name is required'))
    .min(1, 'At least one video is required'),
  projectId: z.string().trim().min(1, 'projectId cannot be empty').optional(),
});

export class ExportController {
  // POST /api/export/video -> validate names, create the export job (owned by the
  // caller), start stitching.
  async exportVideo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { videos, projectId } = exportVideoSchema.parse(req.body);
      const auth = getAuthUser(req);
      const result = await exportService.createExportJob({
        names: videos,
        userId: auth.sub,
        projectId,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const exportController = new ExportController();
