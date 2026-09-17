import { Router } from 'express';
import { authController } from '../controllers/auth.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Public: token acquisition. Everything else on /api requires a Bearer token
// (the global gate in routes/index.ts runs AFTER this mount).
router.post('/register', authController.register.bind(authController));
router.post('/login', authController.login.bind(authController));

// Authenticated: the current principal.
router.get('/me', authenticate, authController.me.bind(authController));

export default router;
