import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/debugController';

const router = Router();
router.use(authenticate);
router.post('/test-email', ctrl.testEmail);
router.get('/email-logs', ctrl.emailLogs);
router.get('/email-status', ctrl.emailStatus);

export default router;
