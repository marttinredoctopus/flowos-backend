import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/debugController';

const router = Router();

// Public endpoints (no auth needed for diagnostics)
router.get('/email-status', ctrl.emailStatus);

// Protected endpoints
router.use(authenticate);
router.post('/test-email', ctrl.testEmail);
router.get('/email-logs', ctrl.emailLogs);

export default router;
