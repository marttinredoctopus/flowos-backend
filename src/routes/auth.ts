import { Router } from 'express';
import * as ctrl from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.post('/verify-email', ctrl.verifyEmail);
router.post('/resend-verification', ctrl.resendVerification);
router.post('/logout', authenticate, ctrl.logout);
router.post('/refresh', ctrl.refresh);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/verify-reset-otp', ctrl.verifyResetOtp);
router.post('/reset-password', ctrl.resetPassword);
router.get('/me', authenticate, ctrl.me);
router.patch('/profile', authenticate, ctrl.updateProfile);
router.post('/change-password', authenticate, ctrl.changePassword);

export default router;
