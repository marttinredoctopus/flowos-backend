import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { redis } from '../config/redis';

async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;
  const result = await fn();
  await redis.setex(key, ttl, JSON.stringify(result));
  return result;
}

export async function overview(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = await cached(`reports:overview:${orgId}`, 300, async () => {
      const [projects, tasks, clients, timeEntries, campaigns, revenue] = await Promise.all([
        pool.query(`SELECT status, COUNT(*) as count FROM projects WHERE org_id = $1 GROUP BY status`, [orgId]),
        pool.query(`SELECT status, COUNT(*) as count FROM tasks WHERE org_id = $1 GROUP BY status`, [orgId]),
        pool.query(`SELECT COUNT(*) as count FROM clients WHERE org_id = $1`, [orgId]),
        pool.query(
          `SELECT SUM(duration_seconds) as total, COUNT(*) as entries
           FROM time_entries te JOIN users u ON u.id = te.user_id
           WHERE u.org_id = $1 AND te.is_running = FALSE`, [orgId]
        ),
        pool.query(`SELECT SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(conversions) as conversions, SUM(spent) as spent FROM ad_campaigns WHERE org_id = $1`, [orgId]),
        pool.query(
          `SELECT COALESCE(SUM(total_amount),0) as total_invoiced,
                  COALESCE(SUM(CASE WHEN status='paid' THEN total_amount END),0) as total_paid,
                  COALESCE(SUM(CASE WHEN status='overdue' THEN total_amount END),0) as total_overdue
           FROM invoices WHERE org_id = $1`, [orgId]
        ).catch(() => ({ rows: [{ total_invoiced: 0, total_paid: 0, total_overdue: 0 }] })),
      ]);

      const taskMap: Record<string, number> = {};
      tasks.rows.forEach((r: any) => { taskMap[r.status] = parseInt(r.count); });
      const projectMap: Record<string, number> = {};
      projects.rows.forEach((r: any) => { projectMap[r.status] = parseInt(r.count); });

      return {
        projects: { total: projects.rows.reduce((s: number, r: any) => s + parseInt(r.count), 0), byStatus: projectMap },
        tasks: { total: tasks.rows.reduce((s: number, r: any) => s + parseInt(r.count), 0), byStatus: taskMap },
        clients: { total: parseInt(clients.rows[0].count) },
        timeTracking: { totalSeconds: parseInt(timeEntries.rows[0].total || '0'), totalEntries: parseInt(timeEntries.rows[0].entries || '0') },
        campaigns: campaigns.rows[0],
        revenue: revenue.rows[0],
      };
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function projectProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = await cached(`reports:projects:${orgId}`, 300, async () => {
      const result = await pool.query(
        `SELECT p.id, p.name, p.status, p.color, p.progress, p.budget,
          c.name as client_name,
          COUNT(t.id) as task_count,
          COUNT(CASE WHEN t.status = 'done' THEN 1 END) as done_count,
          COALESCE(SUM(te.duration_seconds), 0) as time_spent
         FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id
         LEFT JOIN tasks t ON t.project_id = p.id
         LEFT JOIN time_entries te ON te.project_id = p.id AND te.is_running = FALSE
         WHERE p.org_id = $1
         GROUP BY p.id, p.name, p.status, p.color, p.progress, p.budget, c.name
         ORDER BY p.created_at DESC`,
        [orgId]
      );
      return result.rows;
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function teamActivity(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = await cached(`reports:team:${orgId}`, 300, async () => {
      const result = await pool.query(
        `SELECT u.id, u.name, u.avatar_url, u.role,
          COUNT(DISTINCT t.id) as tasks_assigned,
          COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) as tasks_done,
          COALESCE(SUM(te.duration_seconds), 0) as time_logged
         FROM users u
         LEFT JOIN tasks t ON t.assignee_id = u.id AND t.org_id = u.org_id
         LEFT JOIN time_entries te ON te.user_id = u.id AND te.is_running = FALSE
         WHERE u.org_id = $1 AND u.is_active = TRUE
         GROUP BY u.id, u.name, u.avatar_url, u.role
         ORDER BY tasks_done DESC`,
        [orgId]
      );
      return result.rows;
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function revenueOverTime(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const months = parseInt(req.query.months as string) || 6;
    const data = await cached(`reports:revenue:${orgId}:${months}`, 300, async () => {
      const result = await pool.query(
        `SELECT TO_CHAR(DATE_TRUNC('month', issue_date), 'Mon YYYY') as month,
                DATE_TRUNC('month', issue_date) as month_date,
                COALESCE(SUM(total_amount),0) as invoiced,
                COALESCE(SUM(CASE WHEN status='paid' THEN total_amount END),0) as collected
         FROM invoices
         WHERE org_id = $1 AND issue_date >= NOW() - INTERVAL '1 month' * $2
         GROUP BY DATE_TRUNC('month', issue_date)
         ORDER BY month_date ASC`,
        [orgId, months]
      ).catch(() => ({ rows: [] }));
      return result.rows;
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function projectStatusDistribution(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = await cached(`reports:proj-status:${orgId}`, 300, async () => {
      const result = await pool.query(
        `SELECT status as name, COUNT(*) as value FROM projects WHERE org_id = $1 GROUP BY status`,
        [orgId]
      );
      return result.rows.map((r: any) => ({ name: r.name, value: parseInt(r.value) }));
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function teamWorkload(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = await cached(`reports:workload:${orgId}`, 300, async () => {
      const result = await pool.query(
        `SELECT u.name,
          COUNT(CASE WHEN t.status NOT IN ('done','cancelled') THEN 1 END) as active_tasks,
          COUNT(CASE WHEN t.status = 'done' THEN 1 END) as completed_tasks,
          COALESCE(SUM(te.duration_seconds)/3600.0, 0) as hours_logged
         FROM users u
         LEFT JOIN tasks t ON t.assignee_id = u.id
         LEFT JOIN time_entries te ON te.user_id = u.id AND te.is_running = FALSE
           AND te.started_at >= NOW() - INTERVAL '30 days'
         WHERE u.org_id = $1 AND u.is_active = TRUE
         GROUP BY u.id, u.name
         ORDER BY active_tasks DESC`,
        [orgId]
      );
      return result.rows;
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function tasksOverTime(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const weeks = parseInt(req.query.weeks as string) || 8;
    const data = await cached(`reports:tasks-time:${orgId}:${weeks}`, 300, async () => {
      const result = await pool.query(
        `SELECT TO_CHAR(DATE_TRUNC('week', created_at), 'Mon DD') as week,
                COUNT(*) as created,
                COUNT(CASE WHEN status='done' THEN 1 END) as completed
         FROM tasks
         WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '1 week' * $2
         GROUP BY DATE_TRUNC('week', created_at)
         ORDER BY DATE_TRUNC('week', created_at) ASC`,
        [orgId, weeks]
      );
      return result.rows;
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function topClients(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = await cached(`reports:top-clients:${orgId}`, 300, async () => {
      const result = await pool.query(
        `SELECT c.id, c.name, c.logo_url,
          COUNT(DISTINCT p.id) as project_count,
          COALESCE(SUM(i.total_amount),0) as total_invoiced,
          COALESCE(SUM(CASE WHEN i.status='paid' THEN i.total_amount END),0) as total_paid
         FROM clients c
         LEFT JOIN projects p ON p.client_id = c.id
         LEFT JOIN invoices i ON i.client_id = c.id
         WHERE c.org_id = $1
         GROUP BY c.id, c.name, c.logo_url
         ORDER BY total_invoiced DESC
         LIMIT 10`,
        [orgId]
      ).catch(() => ({ rows: [] }));
      return result.rows;
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function timeBreakdown(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = await cached(`reports:time-breakdown:${orgId}`, 300, async () => {
      const [byProject, byUser] = await Promise.all([
        pool.query(
          `SELECT p.name, COALESCE(SUM(te.duration_seconds)/3600.0, 0) as hours
           FROM time_entries te
           JOIN projects p ON p.id = te.project_id
           JOIN users u ON u.id = te.user_id
           WHERE u.org_id = $1 AND te.is_running = FALSE
           GROUP BY p.name ORDER BY hours DESC LIMIT 10`,
          [orgId]
        ),
        pool.query(
          `SELECT u.name, COALESCE(SUM(te.duration_seconds)/3600.0, 0) as hours
           FROM time_entries te
           JOIN users u ON u.id = te.user_id
           WHERE u.org_id = $1 AND te.is_running = FALSE
           GROUP BY u.name ORDER BY hours DESC`,
          [orgId]
        ),
      ]);
      return { byProject: byProject.rows, byUser: byUser.rows };
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function clientsReport(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = await cached(`reports:clients:${orgId}`, 300, async () => {
      const result = await pool.query(
        `SELECT c.id, c.name, c.email, c.logo_url, c.status,
          COUNT(DISTINCT p.id) as projects_total,
          COUNT(DISTINCT CASE WHEN p.status='active' THEN p.id END) as projects_active,
          COALESCE(SUM(i.total_amount),0) as revenue,
          MAX(p.created_at) as last_project_date
         FROM clients c
         LEFT JOIN projects p ON p.client_id = c.id
         LEFT JOIN invoices i ON i.client_id = c.id AND i.status='paid'
         WHERE c.org_id = $1
         GROUP BY c.id, c.name, c.email, c.logo_url, c.status
         ORDER BY revenue DESC`,
        [orgId]
      ).catch(() => ({ rows: [] }));
      return result.rows;
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function financeReport(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = await cached(`reports:finance:${orgId}`, 300, async () => {
      const [summary, expenses, recentInvoices] = await Promise.all([
        pool.query(
          `SELECT
            COALESCE(SUM(total_amount),0) as total_invoiced,
            COALESCE(SUM(CASE WHEN status='paid' THEN total_amount END),0) as total_collected,
            COALESCE(SUM(CASE WHEN status='overdue' THEN total_amount END),0) as total_overdue,
            COALESCE(SUM(CASE WHEN status='draft' THEN total_amount END),0) as total_draft,
            COUNT(*) as invoice_count,
            COUNT(CASE WHEN status='paid' THEN 1 END) as paid_count,
            COUNT(CASE WHEN status='overdue' THEN 1 END) as overdue_count
           FROM invoices WHERE org_id = $1`, [orgId]
        ).catch(() => ({ rows: [{}] })),
        pool.query(
          `SELECT category, COALESCE(SUM(amount),0) as total
           FROM expenses WHERE org_id = $1 AND date >= DATE_TRUNC('month', NOW())
           GROUP BY category ORDER BY total DESC`, [orgId]
        ).catch(() => ({ rows: [] })),
        pool.query(
          `SELECT i.invoice_number, i.total_amount, i.status, i.due_date, c.name as client_name
           FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
           WHERE i.org_id = $1 ORDER BY i.created_at DESC LIMIT 5`, [orgId]
        ).catch(() => ({ rows: [] })),
      ]);
      return { summary: summary.rows[0], expensesByCategory: expenses.rows, recentInvoices: recentInvoices.rows };
    });
    res.json(data);
  } catch (err) { next(err); }
}

export async function getScheduledReports(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT * FROM scheduled_reports WHERE org_id = $1 ORDER BY created_at DESC`,
      [req.user!.orgId]
    ).catch(() => ({ rows: [] }));
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function createScheduledReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, reportType, frequency, recipients, filters } = req.body;
    const result = await pool.query(
      `INSERT INTO scheduled_reports (org_id, name, report_type, frequency, recipients, filters, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user!.orgId, name, reportType, frequency, JSON.stringify(recipients || []), JSON.stringify(filters || {}), req.user!.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function deleteScheduledReport(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query(
      `DELETE FROM scheduled_reports WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.user!.orgId]
    );
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
