import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getClientActivity } from '../controllers/activityController';

const router = Router();
router.use(authenticate);
router.get('/', getClientActivity);

export default router;
