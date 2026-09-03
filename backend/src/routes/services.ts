import { Router } from 'express';
import { servicesController } from '../controllers/services.js';

const router = Router();

// Omniroute routes
router.post('/omniroute/generate', servicesController.omnirouteGenerate.bind(servicesController));
router.get('/omniroute/status/:jobId', servicesController.omnirouteStatus.bind(servicesController));
router.post('/omniroute/cancel/:jobId', servicesController.omnirouteCancel.bind(servicesController));
router.get('/omniroute/models', servicesController.omnirouteModels.bind(servicesController));

// ComfyUI routes
router.post('/comfyui/prompt', servicesController.comfyuiQueuePrompt.bind(servicesController));
router.get('/comfyui/history/:promptId', servicesController.comfyuiHistory.bind(servicesController));
router.get('/comfyui/queue', servicesController.comfyuiQueue.bind(servicesController));
router.get('/comfyui/stats', servicesController.comfyuiStats.bind(servicesController));
router.post('/comfyui/interrupt', servicesController.comfyuiInterrupt.bind(servicesController));
router.post('/comfyui/free', servicesController.comfyuiFreeMemory.bind(servicesController));
router.get('/comfyui/models', servicesController.comfyuiModels.bind(servicesController));
router.get('/comfyui/embeddings', servicesController.comfyuiEmbeddings.bind(servicesController));
router.get('/comfyui/object_info', servicesController.comfyuiObjectInfo.bind(servicesController));

export default router;