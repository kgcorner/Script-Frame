import { Router } from 'express';
import { healthController } from '../controllers/health.js';

const router = Router();

router.get('/', healthController.checkAll.bind(healthController));
router.get('/omniroute', healthController.checkOmniroute.bind(healthController));
router.get('/comfyui', healthController.checkComfyUI.bind(healthController));
router.get('/history', healthController.getHealthHistory.bind(healthController));
router.get('/latest', healthController.getLatestHealth.bind(healthController));

export default router;