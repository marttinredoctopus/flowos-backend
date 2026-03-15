import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT te.*, t.title as task_title, p.name as project_name
       FROM time_entries te
       LEFT JOIN tasks t ON t.id = te.task_id
       LEFT JOIN projects p ON p.id = te.project_id
       WHERE te.user_id = $1
       ORDER BY te.started_at DESC LIMIT 50`,
      [req.user!.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function getRunning(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT te.*, t.title as task_title, p.name as project_name
       FROM time_entries te
       LEFT JOIN tasks t ON t.id = te.task_id
       LEFT JOIN projects p ON p.id = te.project_id
       WHERE te.user_id = $1 AND te.is_running = TRUE LIMIT 1`,
      [req.user!.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) { next(err); }
}

export async function start(req: Request, res: Response, next: NextFunction) {
  try {
    const { taskId, projectId, description } = req.body;
    // Stop any running entry first
    await pool.query(
      `UPDATE time_entries SET
        is_running = FALSE, ended_at = NOW(),
        duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
       WHERE user_id = $1 AND is_running = TRUE`,
      [req.user!.id]
    );
    const result = await pool.query(
      `INSERT INTO time_entries (user_id, task_id, project_id, description, started_at, is_running)
       VALUES ($1,$2,$3,$4,NOW(),TRUE) RETURNING *`,
      [req.user!.id, taskId || null, projectId || null, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function stop(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `UPDATE time_entries SET
        is_running = FALSE, ended_at = NOW(),
        duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user!.id]
    );
    if (!result.rows[0]) throw new AppError('Time entry not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { taskId, projectId, description, startedAt, endedAt, durationSeconds } = req.body;
    if (!startedAt) throw new AppError('startedAt is required', 400);
    const result = await pool.query(
      `INSERT INTO time_entries (user_id, task_id, project_id, description, started_at, ended_at, duration_seconds, is_running)
       VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE) RETURNING *`,
      [req.user!.id, taskId || null, projectId || null, description, startedAt, endedAt || null, durationSeconds || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM time_entries WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function summary(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT
        SUM(duration_seconds) as total_seconds,
        COUNT(*) as entry_count,
        SUM(CASE WHEN started_at >= NOW() - INTERVAL '7 days' THEN duration_seconds ELSE 0 END) as week_seconds,
        SUM(CASE WHEN started_at >= NOW() - INTERVAL '30 days' THEN duration_seconds ELSE 0 END) as month_seconds
       FROM time_entries
       WHERE user_id = $1 AND is_running = FALSE`,
      [req.user!.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}
