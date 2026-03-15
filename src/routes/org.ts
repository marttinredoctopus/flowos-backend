import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as ctrl from '../controllers/orgController';

const router = Router();
router.use(authenticate);
router.get('/settings', ctrl.getOrgSettings);
router.patch('/settings', ctrl.updateOrgSettings);
router.get('/team', ctrl.listTeam);
router.patch('/team/:id/role', ctrl.updateMemberRole);
router.delete('/team/:id', ctrl.removeMember);
export default router;
