import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /api/dashboard/stats — admin overview
router.get('/stats', async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const [projects, tasks, team, invoices, overdue, dueToday] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM projects WHERE org_id=$1 AND status NOT IN ('completed','cancelled')`, [orgId]),
      pool.query(`SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND status != 'done'`, [orgId]),
      pool.query(`SELECT COUNT(*) FROM users WHERE org_id=$1`, [orgId]),
      pool.query(`SELECT COUNT(*), COALESCE(SUM(total_amount),0) as amount FROM invoices WHERE org_id=$1 AND status='sent'`, [orgId]),
      pool.query(`SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND status != 'done' AND due_date < NOW()`, [orgId]),
      pool.query(`SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND status != 'done' AND due_date::date = $2`, [orgId, todayStr]),
    ]);

    res.json({
      activeProjects:  parseInt(projects.rows[0].count),
      openTasks:       parseInt(tasks.rows[0].count),
      teamCount:       parseInt(team.rows[0].count),
      pendingInvoices: parseInt(invoices.rows[0].count),
      pendingAmount:   parseFloat(invoices.rows[0].amount),
      overdueCount:    parseInt(overdue.rows[0].count),
      dueToday:        parseInt(dueToday.rows[0].count),
    });
  } catch (err) { next(err); }
});

export default router;
