import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, category } = req.query;
    let sql = `SELECT i.*, u.name as created_by_name, p.name as project_name
               FROM ideas i
               LEFT JOIN users u ON u.id = i.created_by
               LEFT JOIN projects p ON p.id = i.project_id
               WHERE i.org_id = $1`;
    const params: any[] = [req.user!.orgId];
    if (projectId) { params.push(projectId); sql += ` AND i.project_id = $${params.length}`; }
    if (category) { params.push(category); sql += ` AND i.category = $${params.length}`; }
    sql += ' ORDER BY i.votes DESC, i.created_at DESC';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, category, projectId, tags } = req.body;
    if (!title) throw new AppError('Title is required', 400);
    const result = await pool.query(
      `INSERT INTO ideas (org_id, title, description, category, project_id, tags, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user!.orgId, title, description, category || 'general', projectId || null, tags || [], req.user!.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, category, status, tags } = req.body;
    const result = await pool.query(
      `UPDATE ideas SET
        title = COALESCE($1, title), description = COALESCE($2, description),
        category = COALESCE($3, category), status = COALESCE($4, status),
        tags = COALESCE($5, tags), updated_at = NOW()
       WHERE id = $6 AND org_id = $7 RETURNING *`,
      [title, description, category, status, tags, req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Idea not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function vote(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      'UPDATE ideas SET votes = votes + 1 WHERE id = $1 AND org_id = $2 RETURNING votes',
      [req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Idea not found', 404);
    res.json({ votes: result.rows[0].votes });
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM ideas WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}
