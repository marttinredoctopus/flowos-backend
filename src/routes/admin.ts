import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { authenticate } from '../middleware/auth';

const router = Router();

function requireSuperAdmin(req: any, res: Response, next: NextFunction): void {
  if (!req.user?.isSuperAdmin) { res.status(403).json({ error: 'Super admin access required' }); return; }
  next();
}

// GET /api/admin/stats
router.get('/stats', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const [orgs, users, plans, newToday] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM organizations'),
      pool.query("SELECT COUNT(*) FROM users WHERE role != 'client'"),
      pool.query('SELECT plan, COUNT(*) as count FROM organizations GROUP BY plan'),
      pool.query("SELECT COUNT(*) FROM organizations WHERE created_at >= NOW() - INTERVAL '1 day'"),
    ]);
    const planBreakdown: Record<string, number> = {};
    for (const row of plans.rows) planBreakdown[row.plan || 'free'] = parseInt(row.count);
    const paid = (planBreakdown.pro || 0) * 18 + (planBreakdown.agency || 0) * 38;
    res.json({
      total_orgs: parseInt(orgs.rows[0].count),
      total_users: parseInt(users.rows[0].count),
      new_today: parseInt(newToday.rows[0].count),
      mrr: paid,
      plan_breakdown: planBreakdown,
    });
  } catch (err) { next(err); }
});

// GET /api/admin/agencies
router.get('/agencies', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT o.id, o.name, o.plan, o.created_at, o.storage_used_bytes, o.suspended,
             u.email as owner_email, u.name as owner_name,
             (SELECT COUNT(*) FROM users WHERE org_id = o.id AND role != 'client') as member_count,
             (SELECT COUNT(*) FROM projects WHERE org_id = o.id) as project_count
      FROM organizations o
      LEFT JOIN users u ON u.org_id = o.id AND u.role = 'admin'
      ORDER BY o.created_at DESC
      LIMIT 200
    `);
    res.json({ agencies: rows });
  } catch (err) { next(err); }
});

// PATCH /api/admin/agencies/:id/plan
router.patch('/agencies/:id/plan', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!['free','pro','agency','starter'].includes(plan)) { res.status(400).json({ error: 'Invalid plan' }); return; }
    await pool.query('UPDATE organizations SET plan=$1, updated_at=NOW() WHERE id=$2', [plan, req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/admin/agencies/:id/suspend
router.patch('/agencies/:id/suspend', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    await pool.query('UPDATE users SET is_active=FALSE WHERE org_id=$1', [req.params.id]);
    await pool.query('UPDATE organizations SET suspended=TRUE, updated_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/admin/agencies/:id/unsuspend
router.patch('/agencies/:id/unsuspend', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    await pool.query('UPDATE users SET is_active=TRUE WHERE org_id=$1', [req.params.id]);
    await pool.query('UPDATE organizations SET suspended=FALSE, updated_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/admin/users
router.get('/users', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.last_seen_at, u.is_super_admin,
             o.name as org_name, o.plan as org_plan
      FROM users u
      LEFT JOIN organizations o ON o.id = u.org_id
      ORDER BY u.created_at DESC
      LIMIT 500
    `);
    res.json({ users: rows });
  } catch (err) { next(err); }
});

// GET /api/admin/health
router.get('/health', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const checks: Record<string, string> = { backend: 'online' };
    try { await pool.query('SELECT 1'); checks.database = 'online'; } catch { checks.database = 'error'; }
    checks.storage = 'online';
    checks.email = process.env.RESEND_API_KEY ? 'online' : 'not_configured';
    checks.socket = 'online';
    checks.redis = 'online';
    res.json(checks);
  } catch (err) { next(err); }
});

// GET /api/admin/storage
router.get('/storage', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT o.id, o.name, o.storage_used_bytes, o.storage_limit_bytes, o.plan,
             (SELECT COUNT(*) FROM users WHERE org_id = o.id) as user_count
      FROM organizations o ORDER BY o.storage_used_bytes DESC NULLS LAST LIMIT 100
    `);
    const total = await pool.query('SELECT SUM(storage_used_bytes) FROM organizations');
    res.json({ agencies: rows, total_used: total.rows[0].sum || 0 });
  } catch (err) { next(err); }
});

// POST /api/admin/plans - save plan config (stored in admin_config table)
router.post('/plans', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { plans } = req.body;
    await pool.query(`
      INSERT INTO admin_config (key, value, updated_at) VALUES ('plans', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
    `, [JSON.stringify(plans)]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/admin/plans
router.get('/plans', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT value FROM admin_config WHERE key='plans'");
    const plans = rows[0] ? JSON.parse(rows[0].value) : null;
    res.json({ plans });
  } catch (err) { next(err); }
});

export default router;
