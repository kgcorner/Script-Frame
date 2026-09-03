import { Router } from 'express';
import { scriptframeWorkflowController } from '../controllers/scriptframeWorkflow.js';

const router = Router();

router.post('/test-connection', scriptframeWorkflowController.testConnection.bind(scriptframeWorkflowController));
router.post('/test-connections', scriptframeWorkflowController.testAllConnections.bind(scriptframeWorkflowController));
router.post('/', scriptframeWorkflowController.createWorkflow.bind(scriptframeWorkflowController));
router.get('/', scriptframeWorkflowController.getWorkflows.bind(scriptframeWorkflowController));
router.get('/:id', scriptframeWorkflowController.getWorkflow.bind(scriptframeWorkflowController));
router.patch('/:id', scriptframeWorkflowController.updateWorkflow.bind(scriptframeWorkflowController));
router.delete('/:id', scriptframeWorkflowController.deleteWorkflow.bind(scriptframeWorkflowController));

export default router;
