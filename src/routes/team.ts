import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/teamController';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.post('/invite', ctrl.invite);
router.patch('/:id', ctrl.updateMember);
router.delete('/:id', ctrl.removeMember);

export default router;
