import { Router, Request, Response, NextFunction } from 'express';
import { apiKeyAuth } from '../middleware/apiKeyAuth';
import { pool } from '../config/database';

const router = Router();
router.use(apiKeyAuth);

function ok(data: any, meta?: any) {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

function err(code: string, message: string, status = 400) {
  return { success: false, error: { code, message } };
}

function parseQuery(q: any) {
  const page = Math.max(1, parseInt(q.page as string) || 1);
  const limit = Math.min(100, parseInt(q.limit as string) || 20);
  const offset = (page - 1) * limit;
  const sort = (q.sort as string) || 'created_at';
  const order = (q.order as string)?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const filter: any = q.filter || {};
  return { page, limit, offset, sort, order, filter };
}

// ── PROJECTS ──────────────────────────────────────────────────────────────────
router.get('/projects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, offset } = parseQuery(req.query);
    const orgId = req.user!.orgId;
    const result = await pool.query(
      `SELECT p.*, c.name as client_name,
        COUNT(t.id) as task_count,
        COUNT(t.id) FILTER (WHERE t.status='done') as done_count
       FROM projects p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN tasks t ON t.project_id=p.id
       WHERE p.org_id=$1 GROUP BY p.id, c.name ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    );
    const total = (await pool.query('SELECT COUNT(*) FROM projects WHERE org_id=$1', [orgId])).rows[0].count;
    res.json(ok(result.rows, { total: parseInt(total), page, limit, has_more: offset + limit < parseInt(total) }));
  } catch (err) { return next(err); }
});

router.get('/projects/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await pool.query('SELECT p.*, c.name as client_name FROM projects p LEFT JOIN clients c ON c.id=p.client_id WHERE p.id=$1 AND p.org_id=$2', [req.params.id, req.user!.orgId]);
    if (!r.rows[0]) return res.status(404).json(err('NOT_FOUND', 'Project not found', 404));
    res.json(ok(r.rows[0]));
  } catch (e) { return next(e); }
});

router.post('/projects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, status, clientId, startDate, endDate, budget } = req.body;
    if (!name) return res.status(400).json(err('VALIDATION_ERROR', 'name is required'));
    const r = await pool.query(
      `INSERT INTO projects (org_id, name, description, status, client_id, start_date, end_date, budget) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user!.orgId, name, description, status || 'active', clientId, startDate, endDate, budget]
    );
    res.status(201).json(ok(r.rows[0]));
  } catch (e) { return next(e); }
});

router.patch('/projects/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, status, startDate, endDate, budget } = req.body;
    const r = await pool.query(
      `UPDATE projects SET name=COALESCE($1,name), description=COALESCE($2,description), status=COALESCE($3,status), start_date=COALESCE($4,start_date), end_date=COALESCE($5,end_date), budget=COALESCE($6,budget), updated_at=NOW() WHERE id=$7 AND org_id=$8 RETURNING *`,
      [name, description, status, startDate, endDate, budget, req.params.id, req.user!.orgId]
    );
    if (!r.rows[0]) return res.status(404).json(err('NOT_FOUND', 'Project not found'));
    res.json(ok(r.rows[0]));
  } catch (e) { return next(e); }
});

router.delete('/projects/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await pool.query(`UPDATE projects SET status='archived' WHERE id=$1 AND org_id=$2`, [req.params.id, req.user!.orgId]);
    res.json(ok({ archived: true }));
  } catch (e) { return next(e); }
});

router.get('/projects/:id/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit, offset } = parseQuery(req.query);
    const r = await pool.query(
      `SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=$1 AND t.org_id=$2 ORDER BY t.created_at DESC LIMIT $3 OFFSET $4`,
      [req.params.id, req.user!.orgId, limit, offset]
    );
    res.json(ok(r.rows));
  } catch (e) { return next(e); }
});

// ── TASKS ─────────────────────────────────────────────────────────────────────
router.get('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, offset, filter } = parseQuery(req.query);
    const orgId = req.user!.orgId;
    const params: any[] = [orgId];
    let where = 'WHERE t.org_id=$1';
    if (filter.status) { params.push(filter.status); where += ` AND t.status=$${params.length}`; }
    if (filter.project_id) { params.push(filter.project_id); where += ` AND t.project_id=$${params.length}`; }
    if (filter.assignee_id) { params.push(filter.assignee_id); where += ` AND t.assignee_id=$${params.length}`; }
    if (filter.due_date_from) { params.push(filter.due_date_from); where += ` AND t.due_date>=$${params.length}`; }
    if (filter.due_date_to) { params.push(filter.due_date_to); where += ` AND t.due_date<=$${params.length}`; }
    params.push(limit, offset);
    const r = await pool.query(
      `SELECT t.*, u.name as assignee_name, p.name as project_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN projects p ON p.id=t.project_id ${where} ORDER BY t.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );
    const total = (await pool.query('SELECT COUNT(*) FROM tasks WHERE org_id=$1', [orgId])).rows[0].count;
    res.json(ok(r.rows, { total: parseInt(total), page, limit, has_more: offset + limit < parseInt(total) }));
  } catch (e) { return next(e); }
});

router.get('/tasks/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await pool.query(`SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.id=$1 AND t.org_id=$2`, [req.params.id, req.user!.orgId]);
    if (!r.rows[0]) return res.status(404).json(err('NOT_FOUND', 'Task not found'));
    const assignees = await pool.query('SELECT u.id, u.name, u.avatar_url FROM task_assignees ta JOIN users u ON u.id=ta.user_id WHERE ta.task_id=$1', [req.params.id]);
    const comments = await pool.query('SELECT c.*, u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=$1 ORDER BY c.created_at ASC', [req.params.id]);
    res.json(ok({ ...r.rows[0], assignees: assignees.rows, comments: comments.rows }));
  } catch (e) { return next(e); }
});

router.post('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, status, priority, projectId, assigneeId, dueDate } = req.body;
    if (!title) return res.status(400).json(err('VALIDATION_ERROR', 'title is required'));
    const r = await pool.query(
      `INSERT INTO tasks (org_id, title, description, status, priority, project_id, assignee_id, due_date, reporter_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user!.orgId, title, description, status || 'todo', priority || 'medium', projectId, assigneeId, dueDate, req.user!.id]
    );
    res.status(201).json(ok(r.rows[0]));
  } catch (e) { return next(e); }
});

router.patch('/tasks/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, status, priority, assigneeId, dueDate } = req.body;
    const r = await pool.query(
      `UPDATE tasks SET title=COALESCE($1,title), description=COALESCE($2,description), status=COALESCE($3,status), priority=COALESCE($4,priority), assignee_id=COALESCE($5,assignee_id), due_date=COALESCE($6,due_date), updated_at=NOW() WHERE id=$7 AND org_id=$8 RETURNING *`,
      [title, description, status, priority, assigneeId, dueDate, req.params.id, req.user!.orgId]
    );
    if (!r.rows[0]) return res.status(404).json(err('NOT_FOUND', 'Task not found'));
    res.json(ok(r.rows[0]));
  } catch (e) { return next(e); }
});

router.delete('/tasks/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id=$1 AND org_id=$2', [req.params.id, req.user!.orgId]);
    res.json(ok({ deleted: true }));
  } catch (e) { return next(e); }
});

router.post('/tasks/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { body } = req.body;
    if (!body) return res.status(400).json(err('VALIDATION_ERROR', 'body is required'));
    const r = await pool.query('INSERT INTO comments (task_id, user_id, body) VALUES ($1,$2,$3) RETURNING *', [req.params.id, req.user!.id, body]);
    res.status(201).json(ok(r.rows[0]));
  } catch (e) { return next(e); }
});

// ── CLIENTS ───────────────────────────────────────────────────────────────────
router.get('/clients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit, offset } = parseQuery(req.query);
    const orgId = req.user!.orgId;
    const r = await pool.query(
      `SELECT c.*, COUNT(p.id) as project_count FROM clients c LEFT JOIN projects p ON p.client_id=c.id AND p.org_id=$1 WHERE c.org_id=$1 GROUP BY c.id ORDER BY c.name LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    );
    const total = (await pool.query('SELECT COUNT(*) FROM clients WHERE org_id=$1', [orgId])).rows[0].count;
    res.json(ok(r.rows, { total: parseInt(total), limit }));
  } catch (e) { return next(e); }
});

router.get('/clients/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await pool.query('SELECT * FROM clients WHERE id=$1 AND org_id=$2', [req.params.id, req.user!.orgId]);
    if (!r.rows[0]) return res.status(404).json(err('NOT_FOUND', 'Client not found'));
    const projects = await pool.query('SELECT id, name, status, progress FROM projects WHERE client_id=$1', [req.params.id]);
    res.json(ok({ ...r.rows[0], projects: projects.rows }));
  } catch (e) { return next(e); }
});

router.post('/clients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, company, phone } = req.body;
    if (!name) return res.status(400).json(err('VALIDATION_ERROR', 'name is required'));
    const r = await pool.query('INSERT INTO clients (org_id, name, email, company, phone) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.user!.orgId, name, email, company, phone]);
    res.status(201).json(ok(r.rows[0]));
  } catch (e) { return next(e); }
});

router.patch('/clients/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, company, phone } = req.body;
    const r = await pool.query(
      `UPDATE clients SET name=COALESCE($1,name), email=COALESCE($2,email), company=COALESCE($3,company), phone=COALESCE($4,phone) WHERE id=$5 AND org_id=$6 RETURNING *`,
      [name, email, company, phone, req.params.id, req.user!.orgId]
    );
    if (!r.rows[0]) return res.status(404).json(err('NOT_FOUND', 'Client not found'));
    res.json(ok(r.rows[0]));
  } catch (e) { return next(e); }
});

// ── TEAM ──────────────────────────────────────────────────────────────────────
router.get('/team', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await pool.query(
      `SELECT id, name, role, email, avatar_url, created_at FROM users WHERE org_id=$1 AND role!='client' ORDER BY name`,
      [req.user!.orgId]
    );
    res.json(ok(r.rows));
  } catch (e) { return next(e); }
});

// ── TIME ENTRIES ──────────────────────────────────────────────────────────────
router.get('/time-entries', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, offset, filter } = parseQuery(req.query);
    const params: any[] = [req.user!.orgId];
    let where = 'WHERE te.org_id=$1';
    if (filter.user_id) { params.push(filter.user_id); where += ` AND te.user_id=$${params.length}`; }
    if (filter.project_id) { params.push(filter.project_id); where += ` AND te.project_id=$${params.length}`; }
    if (filter.date_from) { params.push(filter.date_from); where += ` AND te.started_at>=$${params.length}`; }
    if (filter.date_to) { params.push(filter.date_to); where += ` AND te.started_at<=$${params.length}`; }
    params.push(limit, offset);
    const r = await pool.query(
      `SELECT te.*, u.name as user_name, p.name as project_name FROM time_entries te LEFT JOIN users u ON u.id=te.user_id LEFT JOIN projects p ON p.id=te.project_id ${where} ORDER BY te.started_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );
    res.json(ok(r.rows, { page, limit }));
  } catch (e) { return next(e); }
});

router.post('/time-entries', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { description, projectId, taskId, durationSeconds, startedAt, isBillable } = req.body;
    const r = await pool.query(
      `INSERT INTO time_entries (org_id, user_id, project_id, task_id, description, duration_seconds, started_at, is_billable) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user!.orgId, req.user!.id, projectId, taskId, description, durationSeconds, startedAt || new Date(), isBillable || false]
    );
    res.status(201).json(ok(r.rows[0]));
  } catch (e) { return next(e); }
});

// ── INVOICES ──────────────────────────────────────────────────────────────────
router.get('/invoices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit, offset, filter } = parseQuery(req.query);
    const params: any[] = [req.user!.orgId];
    let where = 'WHERE i.org_id=$1';
    if (filter.status) { params.push(filter.status); where += ` AND i.status=$${params.length}`; }
    params.push(limit, offset);
    const r = await pool.query(
      `SELECT i.*, c.name as client_name FROM invoices i LEFT JOIN clients c ON c.id=i.client_id ${where} ORDER BY i.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    ).catch(() => ({ rows: [] }));
    res.json(ok(r.rows));
  } catch (e) { return next(e); }
});

router.get('/invoices/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await pool.query('SELECT i.*, c.name as client_name FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.id=$1 AND i.org_id=$2', [req.params.id, req.user!.orgId]).catch(() => ({ rows: [] }));
    if (!r.rows[0]) return res.status(404).json(err('NOT_FOUND', 'Invoice not found'));
    res.json(ok(r.rows[0]));
  } catch (e) { return next(e); }
});

// ── REPORTS ───────────────────────────────────────────────────────────────────
router.get('/reports/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.orgId;
    const [projects, tasks, clients, team] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='active') as active FROM projects WHERE org_id=$1`, [orgId]),
      pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='done') as done, COUNT(*) FILTER (WHERE status!='done' AND due_date<NOW()) as overdue FROM tasks WHERE org_id=$1`, [orgId]),
      pool.query('SELECT COUNT(*) as total FROM clients WHERE org_id=$1', [orgId]),
      pool.query(`SELECT COUNT(*) as total FROM users WHERE org_id=$1 AND role!='client'`, [orgId]),
    ]);
    res.json(ok({
      projects: { total: parseInt(projects.rows[0].total), active: parseInt(projects.rows[0].active) },
      tasks: { total: parseInt(tasks.rows[0].total), done: parseInt(tasks.rows[0].done), overdue: parseInt(tasks.rows[0].overdue) },
      clients: parseInt(clients.rows[0].total),
      team: parseInt(team.rows[0].total),
    }));
  } catch (e) { return next(e); }
});

router.get('/reports/projects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.name, p.status, p.progress, p.budget, p.start_date, p.end_date, c.name as client_name,
        COUNT(t.id) as task_count, COUNT(t.id) FILTER (WHERE t.status='done') as done_count
       FROM projects p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN tasks t ON t.project_id=p.id
       WHERE p.org_id=$1 GROUP BY p.id, c.name ORDER BY p.name`,
      [req.user!.orgId]
    );
    res.json(ok(r.rows));
  } catch (e) { return next(e); }
});

router.get('/reports/team', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, u.role, u.avatar_url,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status!='done') as open_tasks,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status='done') as done_tasks
       FROM users u LEFT JOIN tasks t ON t.assignee_id=u.id AND t.org_id=$1
       WHERE u.org_id=$1 AND u.role!='client' GROUP BY u.id ORDER BY u.name`,
      [req.user!.orgId]
    );
    res.json(ok(r.rows));
  } catch (e) { return next(e); }
});

export default router;
