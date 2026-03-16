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

// GET /api/dashboard/manager-stats
router.get('/manager-stats', async (req, res, next) => {
  try {
    const { orgId, id: userId } = req.user!;
    const [myProjects, pendingReview, teamOpenTasks, overdueTasks] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM projects WHERE org_id=$1 AND status='active'`, [orgId]),
      pool.query(`SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND status='review'`, [orgId]),
      pool.query(`SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND status != 'done'`, [orgId]),
      pool.query(`SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND status != 'done' AND due_date < NOW()`, [orgId]),
    ]);
    res.json({
      myProjects:    parseInt(myProjects.rows[0].count),
      pendingReview: parseInt(pendingReview.rows[0].count),
      teamOpenTasks: parseInt(teamOpenTasks.rows[0].count),
      overdueTasks:  parseInt(overdueTasks.rows[0].count),
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/member-stats
router.get('/member-stats', async (req, res, next) => {
  try {
    const { orgId, id: userId } = req.user!;
    const todayStr = new Date().toISOString().split('T')[0];
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    const [openTasks, dueToday, completedToday, hoursThisWeek] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND assignee_id=$2 AND status != 'done'`, [orgId, userId]),
      pool.query(`SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND assignee_id=$2 AND status != 'done' AND due_date::date=$3`, [orgId, userId, todayStr]),
      pool.query(`SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND assignee_id=$2 AND status='done' AND completed_at::date=$3`, [orgId, userId, todayStr]),
      pool.query(`SELECT COALESCE(SUM(duration_minutes),0)/60.0 as hours FROM time_entries WHERE org_id=$1 AND user_id=$2 AND started_at>=$3`, [orgId, userId, weekStart]),
    ]);
    res.json({
      openTasks:      parseInt(openTasks.rows[0].count),
      dueToday:       parseInt(dueToday.rows[0].count),
      completedToday: parseInt(completedToday.rows[0].count),
      hoursThisWeek:  Math.round(parseFloat(hoursThisWeek.rows[0].hours) * 10) / 10,
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/activity
router.get('/activity', async (req, res, next) => {
  try {
    const { orgId } = req.user!;
    const limit = parseInt(String(req.query.limit || '10'));
    // Return recent task completions and project creations as activity feed
    const result = await pool.query(`
      SELECT 'task_done' as type, t.title, u.name as actor, t.updated_at as ts
      FROM tasks t JOIN users u ON u.id=t.assignee_id
      WHERE t.org_id=$1 AND t.status='done' AND t.updated_at > NOW()-INTERVAL '7 days'
      ORDER BY t.updated_at DESC LIMIT $2
    `, [orgId, limit]);
    const activities = result.rows.map(r => ({
      icon: '✅',
      text: `${r.actor} completed "${r.title}"`,
      time: new Date(r.ts).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    }));
    res.json({ activities });
  } catch (err) { next(err); }
});

export default router;
