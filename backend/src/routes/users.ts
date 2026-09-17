import { Router } from 'express';
import { userController } from '../controllers/user.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

// All user-management routes require a valid token (the global gate in
// routes/index.ts already ran, so this is a defensive restatement); listing and
// creating users is admin-only. Self-or-admin rules live in the controller.
router.use(authenticate);

router.post('/', requireAdmin, userController.createUser.bind(userController));
router.get('/', requireAdmin, userController.getUsers.bind(userController));
router.get('/:id', userController.getUser.bind(userController));
router.patch('/:id', userController.updateUser.bind(userController));
router.delete('/:id', requireAdmin, userController.deleteUser.bind(userController));

export default router;
