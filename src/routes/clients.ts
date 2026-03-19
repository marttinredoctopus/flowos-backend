import { Router } from 'express';
import { authenticate, adminOrManager, staffOnly } from '../middleware/auth';
import { checkPlanLimit } from '../middleware/planLimits';
import * as ctrl from '../controllers/clientController';

const router = Router();
router.use(authenticate);
// Client-role users cannot access the internal clients list — they use the portal
router.use(staffOnly);

router.get('/', ctrl.list);
router.post('/', adminOrManager, checkPlanLimit('clients'), ctrl.create);
router.get('/:id', ctrl.getOne);
router.patch('/:id', adminOrManager, ctrl.update);
router.delete('/:id', adminOrManager, ctrl.remove);
router.post('/:id/share-token', adminOrManager, ctrl.generateShareToken);

export default router;
