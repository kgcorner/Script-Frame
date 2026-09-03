import { Router } from 'express';
import { comfyuiStacksController } from '../controllers/comfyuiStacks.js';

const router = Router();

router.post('/', comfyuiStacksController.createStack.bind(comfyuiStacksController));
router.get('/', comfyuiStacksController.getStacks.bind(comfyuiStacksController));
router.get('/:id', comfyuiStacksController.getStack.bind(comfyuiStacksController));
router.get('/:id/test', comfyuiStacksController.testStack.bind(comfyuiStacksController));
router.patch('/:id', comfyuiStacksController.updateStack.bind(comfyuiStacksController));
router.delete('/:id', comfyuiStacksController.deleteStack.bind(comfyuiStacksController));

export default router;