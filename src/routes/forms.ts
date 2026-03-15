import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/formsController';

const router = Router();

// Public form submission (no auth)
router.post('/public/:slug/submit', ctrl.submitResponse);

// Authenticated routes
router.use(authenticate);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getOne);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.get('/:id/responses', ctrl.getResponses);

export default router;
