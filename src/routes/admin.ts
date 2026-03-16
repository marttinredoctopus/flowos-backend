import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// Super admin guard
function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!(req.user as any).isSuperAdmin) {
    res.status(403).json({ error: 'Super admin access required' }); return;
  }
  next();
}

// GET /api/admin/stats
router.get('/stats', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [orgs, users, mrr] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE plan='starter') as starter,
          COUNT(*) FILTER (WHERE plan='pro') as pro,
          COUNT(*) FILTER (WHERE plan='enterprise') as enterprise,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as new_this_month
        FROM organizations
      `),
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query(`
        SELECT COALESCE(SUM(
          CASE
            WHEN plan='pro' AND billing_cycle='monthly' THEN 49
            WHEN plan='pro' AND billing_cycle='annual' THEN 39
            WHEN plan='enterprise' AND billing_cycle='monthly' THEN 149
            WHEN plan='enterprise' AND billing_cycle='annual' THEN 119
            ELSE 0
          END
        ), 0) as mrr
        FROM organizations
      `),
    ]);

    const o = orgs.rows[0];
    const mrrVal = parseFloat(mrr.rows[0].mrr);

    res.json({
      total_orgs: parseInt(o.total),
      plan_breakdown: {
        starter:    parseInt(o.starter),
        pro:        parseInt(o.pro),
        enterprise: parseInt(o.enterprise),
      },
      new_orgs_this_month: parseInt(o.new_this_month),
      total_users: parseInt(users.rows[0].count),
      mrr: mrrVal,
      arr: mrrVal * 12,
    });
  } catch (err) { next(err); }
});

// GET /api/admin/orgs — list all orgs
router.get('/orgs', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(`
      SELECT o.id, o.name, o.slug, o.plan, o.billing_cycle, o.created_at,
             COUNT(u.id) as user_count
      FROM organizations o
      LEFT JOIN users u ON u.org_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

export default router;
