import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/reportController';

const router = Router();
router.use(authenticate);

router.get('/overview', ctrl.overview);
router.get('/projects', ctrl.projectProgress);
router.get('/team', ctrl.teamActivity);

export default router;
