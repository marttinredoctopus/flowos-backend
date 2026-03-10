import { Router } from 'express';
import * as ctrl from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.post('/logout', authenticate, ctrl.logout);
router.post('/refresh', ctrl.refresh);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/reset-password', ctrl.resetPassword);
router.get('/me', authenticate, ctrl.me);

export default router;
