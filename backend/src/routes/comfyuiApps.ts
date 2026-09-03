import { Router } from 'express';
import { comfyuiAppController } from '../controllers/comfyuiApp.js';

const router = Router();

router.post('/', comfyuiAppController.createApp.bind(comfyuiAppController));
router.get('/', comfyuiAppController.getApps.bind(comfyuiAppController));
router.get('/:id', comfyuiAppController.getApp.bind(comfyuiAppController));
router.get('/:id/inputs', comfyuiAppController.getAppWorkflowInputs.bind(comfyuiAppController));
router.post('/:id/execute', comfyuiAppController.executeApp.bind(comfyuiAppController));
router.patch('/:id', comfyuiAppController.updateApp.bind(comfyuiAppController));
router.delete('/:id', comfyuiAppController.deleteApp.bind(comfyuiAppController));

export default router;