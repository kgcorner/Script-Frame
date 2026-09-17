// Routes: video export. POST /export/video stitches stored video artifacts (by name,
// in the given order) into one final video. Delivery happens through the shared
// GET /api/jobs/:id/status and GET /artifact/:name endpoints.
import { Router } from 'express';
import { exportController } from '../controllers/export.js';

const router = Router();

router.post('/video', exportController.exportVideo.bind(exportController));

export default router;
