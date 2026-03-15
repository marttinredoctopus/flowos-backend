import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function listGoals(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await pool.query(
      `SELECT g.*, u.name as owner_name,
              COALESCE(
                (SELECT AVG(
                  CASE WHEN kr.target_value = kr.start_value THEN 0
                  ELSE GREATEST(0, LEAST(100, ((kr.current_value - kr.start_value) / NULLIF(kr.target_value - kr.start_value, 0)) * 100))
                  END
                ) FROM key_results kr WHERE kr.goal_id = g.id), 0
              ) as progress
       FROM goals g
       LEFT JOIN users u ON u.id = g.owner_id
       WHERE g.org_id = $1
       ORDER BY g.created_at DESC`,
      [req.user!.orgId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function createGoal(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, ownerId, dueDate, category } = req.body;
    if (!title) throw new AppError('Title required', 400);
    const row = await pool.query(
      `INSERT INTO goals (org_id, title, description, owner_id, due_date, category)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user!.orgId, title, description || null, ownerId || req.user!.id,
       dueDate || null, category || 'other']
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function getGoal(req: Request, res: Response, next: NextFunction) {
  try {
    const goal = await pool.query(
      `SELECT g.*, u.name as owner_name FROM goals g
       LEFT JOIN users u ON u.id = g.owner_id
       WHERE g.id = $1 AND g.org_id = $2`,
      [req.params.id, req.user!.orgId]
    );
    if (!goal.rows[0]) throw new AppError('Goal not found', 404);

    const krs = await pool.query(
      'SELECT * FROM key_results WHERE goal_id = $1 ORDER BY updated_at ASC',
      [req.params.id]
    );

    res.json({ ...goal.rows[0], key_results: krs.rows });
  } catch (err) { next(err); }
}

export async function updateGoal(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, ownerId, dueDate, category, status } = req.body;
    const row = await pool.query(
      `UPDATE goals SET
        title = COALESCE($1, title), description = COALESCE($2, description),
        owner_id = COALESCE($3, owner_id), due_date = COALESCE($4, due_date),
        category = COALESCE($5, category), status = COALESCE($6, status),
        updated_at = NOW()
       WHERE id = $7 AND org_id = $8 RETURNING *`,
      [title, description, ownerId, dueDate, category, status, req.params.id, req.user!.orgId]
    );
    if (!row.rows[0]) throw new AppError('Goal not found', 404);
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function deleteGoal(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM goals WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

// Key Results
export async function addKeyResult(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, startValue, targetValue, currentValue, unit } = req.body;
    if (!title || targetValue === undefined) throw new AppError('title and targetValue required', 400);

    // Verify goal belongs to org
    const goal = await pool.query('SELECT id FROM goals WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    if (!goal.rows[0]) throw new AppError('Goal not found', 404);

    const row = await pool.query(
      `INSERT INTO key_results (goal_id, title, start_value, target_value, current_value, unit)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, title, startValue || 0, targetValue, currentValue || 0, unit || '']
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function updateKeyResult(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, startValue, targetValue, currentValue, unit } = req.body;
    const row = await pool.query(
      `UPDATE key_results SET
        title = COALESCE($1, title),
        start_value = COALESCE($2, start_value),
        target_value = COALESCE($3, target_value),
        current_value = COALESCE($4, current_value),
        unit = COALESCE($5, unit),
        updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [title, startValue, targetValue, currentValue, unit, req.params.krId]
    );
    if (!row.rows[0]) throw new AppError('Key result not found', 404);
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function deleteKeyResult(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM key_results WHERE id = $1', [req.params.krId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}
