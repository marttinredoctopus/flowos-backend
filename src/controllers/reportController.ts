import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';

export async function overview(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const [projects, tasks, clients, timeEntries, campaigns] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) as count FROM projects WHERE org_id = $1 GROUP BY status`, [orgId]),
      pool.query(`SELECT status, COUNT(*) as count FROM tasks WHERE org_id = $1 GROUP BY status`, [orgId]),
      pool.query(`SELECT COUNT(*) as count FROM clients WHERE org_id = $1`, [orgId]),
      pool.query(
        `SELECT SUM(duration_seconds) as total, COUNT(*) as entries
         FROM time_entries te
         JOIN users u ON u.id = te.user_id
         WHERE u.org_id = $1 AND te.is_running = FALSE`, [orgId]
      ),
      pool.query(`SELECT SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(conversions) as conversions, SUM(spent) as spent FROM ad_campaigns WHERE org_id = $1`, [orgId]),
    ]);

    const taskMap: Record<string, number> = {};
    tasks.rows.forEach((r: any) => { taskMap[r.status] = parseInt(r.count); });
    const projectMap: Record<string, number> = {};
    projects.rows.forEach((r: any) => { projectMap[r.status] = parseInt(r.count); });

    res.json({
      projects: { total: projects.rows.reduce((s: number, r: any) => s + parseInt(r.count), 0), byStatus: projectMap },
      tasks: { total: tasks.rows.reduce((s: number, r: any) => s + parseInt(r.count), 0), byStatus: taskMap },
      clients: { total: parseInt(clients.rows[0].count) },
      timeTracking: { totalSeconds: parseInt(timeEntries.rows[0].total || '0'), totalEntries: parseInt(timeEntries.rows[0].entries || '0') },
      campaigns: campaigns.rows[0],
    });
  } catch (err) { next(err); }
}

export async function projectProgress(req: Request, res: Response, next: NextFunction) {
  try {
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
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function teamActivity(req: Request, res: Response, next: NextFunction) {
  try {
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
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}
