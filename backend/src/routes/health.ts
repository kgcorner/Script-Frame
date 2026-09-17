import { Router } from 'express';
import { healthController } from '../controllers/health.js';

// Public service-reachability probe (GET /api/health/connection). Mounted ahead of
// the global authenticate gate in routes/index.ts so clients can poll connectivity
// before they hold a token (e.g. the sign-in screen's connection indicator). The
// probe records no health history and reads no request/auth state.
export const publicHealthRouter = Router();
publicHealthRouter.get('/connection', healthController.checkConnection.bind(healthController));

// Remaining health endpoints carry service metadata/history, so they stay behind
// the global auth gate (mounted after `authenticate` in routes/index.ts).
const router = Router();

router.get('/', healthController.checkAll.bind(healthController));
router.get('/omniroute', healthController.checkOmniroute.bind(healthController));
router.get('/comfyui', healthController.checkComfyUI.bind(healthController));
router.get('/history', healthController.getHealthHistory.bind(healthController));
router.get('/latest', healthController.getLatestHealth.bind(healthController));

export default router;