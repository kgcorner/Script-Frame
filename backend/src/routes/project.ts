import { Router } from 'express';
import { projectController } from '../controllers/project.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All project routes act on behalf of the token subject; the global gate in
// routes/index.ts already ran — this is the same defensive restatement used by
// routes/users.ts. Ownership rules live in the controller/service.
router.use(authenticate);

router.post('/', projectController.createProject.bind(projectController));
router.get('/', projectController.getProjects.bind(projectController));
router.get('/:id', projectController.getProject.bind(projectController));
router.patch('/:id', projectController.updateProject.bind(projectController));
router.delete('/:id', projectController.deleteProject.bind(projectController));

export default router;
