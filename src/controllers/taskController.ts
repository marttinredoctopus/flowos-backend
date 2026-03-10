import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { triggerTaskAssigned, triggerCommentAdded } from '../services/notificationService';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, status, assigneeId } = req.query;
    let q = `SELECT t.*, u.name as assignee_name, u.avatar_url as assignee_avatar
             FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
             WHERE t.org_id = $1`;
    const params: any[] = [req.user!.orgId];
    if (projectId) { params.push(projectId); q += ` AND t.project_id = $${params.length}`; }
    if (status) { params.push(status); q += ` AND t.status = $${params.length}`; }
    if (assigneeId) { params.push(assigneeId); q += ` AND t.assignee_id = $${params.length}`; }
    q += ' ORDER BY t.position, t.created_at DESC';
    const res2 = await pool.query(q, params);
    res.json(res2.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, title, description, status = 'todo', priority = 'medium', assigneeId, dueDate, estimatedHours, tags } = req.body;
    if (!title) throw new AppError('Title is required', 400);
    const result = await pool.query(
      `INSERT INTO tasks (project_id, org_id, title, description, status, priority, assignee_id, reporter_id, due_date, estimated_hours, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [projectId, req.user!.orgId, title, description, status, priority, assigneeId, req.user!.id, dueDate, estimatedHours, tags]
    );
    const task = result.rows[0];
    if (assigneeId && assigneeId !== req.user!.id) {
      await triggerTaskAssigned(task, assigneeId, req.user!.id);
    }
    res.status(201).json(task);
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT t.*, u.name as assignee_name, u.avatar_url as assignee_avatar,
              r.name as reporter_name, r.avatar_url as reporter_avatar
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       LEFT JOIN users r ON r.id = t.reporter_id
       WHERE t.id = $1 AND t.org_id = $2`,
      [req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Task not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, status, priority, assigneeId, dueDate, estimatedHours, tags, position } = req.body;
    const prev = await pool.query('SELECT * FROM tasks WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    if (!prev.rows[0]) throw new AppError('Task not found', 404);

    const result = await pool.query(
      `UPDATE tasks SET
        title = COALESCE($1, title), description = COALESCE($2, description),
        status = COALESCE($3, status), priority = COALESCE($4, priority),
        assignee_id = COALESCE($5, assignee_id), due_date = COALESCE($6, due_date),
        estimated_hours = COALESCE($7, estimated_hours), tags = COALESCE($8, tags),
        position = COALESCE($9, position), updated_at = NOW()
       WHERE id = $10 AND org_id = $11 RETURNING *`,
      [title, description, status, priority, assigneeId, dueDate, estimatedHours, tags, position, req.params.id, req.user!.orgId]
    );
    const task = result.rows[0];

    // Fire assign notification if assignee changed
    if (assigneeId && assigneeId !== prev.rows[0].assignee_id && assigneeId !== req.user!.id) {
      await triggerTaskAssigned(task, assigneeId, req.user!.id);
    }
    res.json(task);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function addComment(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = req.body;
    if (!body) throw new AppError('Comment body required', 400);
    const taskRes = await pool.query('SELECT * FROM tasks WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    if (!taskRes.rows[0]) throw new AppError('Task not found', 404);
    const task = taskRes.rows[0];

    const result = await pool.query(
      'INSERT INTO comments (task_id, user_id, body) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, req.user!.id, body]
    );
    const comment = result.rows[0];
    await triggerCommentAdded(comment, task, req.user!.id);
    res.status(201).json(comment);
  } catch (err) { next(err); }
}

export async function getComments(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT c.*, u.name, u.avatar_url FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.task_id = $1 ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}
