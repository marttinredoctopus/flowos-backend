import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize, adminOnly, adminOrManager, staffOnly } from '../middleware/auth';
import * as ctrl from '../controllers/orgController';
import { pool } from '../config/database';

const router = Router();
router.use(authenticate);
// All org routes require staff (no client users)
router.use(staffOnly);

// Settings: read = admin+manager, write = admin only
router.get('/settings', ctrl.getOrgSettings);
router.patch('/settings', adminOnly, ctrl.updateOrgSettings);

// Team management: admin+manager only
router.get('/team', adminOrManager, ctrl.listTeam);
router.patch('/team/:id/role', adminOnly, ctrl.updateMemberRole);
router.delete('/team/:id', adminOnly, ctrl.removeMember);

// Onboarding (any staff)
router.patch('/onboarding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = req.user!;
    const { onboardingCompleted } = req.body;
    await pool.query(
      `UPDATE organizations SET onboarding_completed=$1 WHERE id=$2`,
      [onboardingCompleted === true, orgId]
    ).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
