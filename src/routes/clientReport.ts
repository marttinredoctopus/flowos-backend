import { Router } from 'express';
import { authenticate, staffOnly } from '../middleware/auth';
import { getReport, getInsights } from '../controllers/clientReportController';

const router = Router();
router.use(authenticate, staffOnly);

router.get('/:id/report', getReport);
router.get('/:id/insights', getInsights);

export default router;
