import { Router } from 'express';
import { authenticate, adminOrManager, staffOnly } from '../middleware/auth';
import { checkPlanLimit } from '../middleware/planLimits';
import * as ctrl from '../controllers/projectController';

const router = Router();
router.use(authenticate);

// READ: all roles (controller filters by clientId when role === 'client')
router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.get('/:id/tasks', ctrl.getTasks);

// WRITE: staff only
router.post('/', staffOnly, checkPlanLimit('projects'), ctrl.create);
router.patch('/:id', staffOnly, ctrl.update);
router.delete('/:id', adminOrManager, ctrl.remove);
router.post('/:id/members', adminOrManager, ctrl.addMember);

export default router;
