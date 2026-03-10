import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT s.*, c.name as client_name, p.name as project_name, u.name as created_by_name
       FROM shoot_sessions s
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN projects p ON p.id = s.project_id
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.org_id = $1 ORDER BY s.scheduled_at DESC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, shootType, scheduledAt, durationHours, clientId, projectId, location } = req.body;
    if (!title || !scheduledAt) throw new AppError('Title and scheduledAt are required', 400);
    const result = await pool.query(
      `INSERT INTO shoot_sessions (org_id, title, description, shoot_type, scheduled_at, duration_hours, client_id, project_id, location, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user!.orgId, title, description, shootType || 'photo', scheduledAt, durationHours || 2, clientId || null, projectId || null, location, req.user!.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, status, scheduledAt, durationHours, location } = req.body;
    const result = await pool.query(
      `UPDATE shoot_sessions SET
        title = COALESCE($1, title), description = COALESCE($2, description),
        status = COALESCE($3, status), scheduled_at = COALESCE($4, scheduled_at),
        duration_hours = COALESCE($5, duration_hours), location = COALESCE($6, location),
        updated_at = NOW()
       WHERE id = $7 AND org_id = $8 RETURNING *`,
      [title, description, status, scheduledAt, durationHours, location, req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Shoot not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM shoot_sessions WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}
