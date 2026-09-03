import { Router } from 'express';
import { workflowController } from '../controllers/workflow.js';

const router = Router();

router.post('/', workflowController.createWorkflow.bind(workflowController));
router.get('/', workflowController.getWorkflows.bind(workflowController));
router.get('/comfyui/saved', workflowController.getComfyUISavedWorkflows.bind(workflowController));
router.get('/comfyui/history', workflowController.getComfyUIWorkflowHistory.bind(workflowController));
router.get('/:id', workflowController.getWorkflow.bind(workflowController));
router.patch('/:id', workflowController.updateWorkflow.bind(workflowController));
router.post('/:id/activate', workflowController.activateWorkflow.bind(workflowController));
router.post('/:id/deactivate', workflowController.deactivateWorkflow.bind(workflowController));
router.delete('/:id', workflowController.deleteWorkflow.bind(workflowController));

export default router;