import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { checkPlanLimit } from '../middleware/planLimits';
import * as ctrl from '../controllers/clientController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.post('/', checkPlanLimit('clients'), ctrl.create);
router.get('/:id', ctrl.getOne);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
