import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/webhooksController';

const router = Router();
router.use(authenticate);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/test', ctrl.testWebhook);
router.get('/:id/deliveries', ctrl.getDeliveries);
export default router;
