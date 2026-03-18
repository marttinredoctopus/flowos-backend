import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { checkPlanLimit } from '../middleware/planLimits';
import * as ctrl from '../controllers/projectController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.post('/', checkPlanLimit('projects'), ctrl.create);
router.get('/:id', ctrl.getOne);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.get('/:id/tasks', ctrl.getTasks);
router.post('/:id/members', ctrl.addMember);

export default router;
