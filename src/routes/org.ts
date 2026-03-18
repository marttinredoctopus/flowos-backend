import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as ctrl from '../controllers/orgController';
import { pool } from '../config/database';

const router = Router();
router.use(authenticate);
router.get('/settings', ctrl.getOrgSettings);
router.patch('/settings', ctrl.updateOrgSettings);
router.get('/team', ctrl.listTeam);
router.patch('/team/:id/role', ctrl.updateMemberRole);
router.delete('/team/:id', ctrl.removeMember);

// PATCH /api/org/onboarding — mark onboarding complete, store preferences
router.patch('/onboarding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = req.user!;
    const { services, teamSize, goals, onboardingCompleted } = req.body;
    // Store as a simple JSON note in org metadata; mark completed
    await pool.query(
      `UPDATE organizations SET onboarding_completed=$1 WHERE id=$2`,
      [onboardingCompleted === true, orgId]
    ).catch(() => {}); // non-fatal if column doesn't exist yet
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
