import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { parentId } = req.query;
    let q = `SELECT d.*, u.name as created_by_name
             FROM docs d LEFT JOIN users u ON u.id = d.created_by
             WHERE d.org_id = $1 AND d.is_archived = FALSE`;
    const params: any[] = [req.user!.orgId];
    if (parentId === 'null' || parentId === undefined) {
      q += ' AND d.parent_id IS NULL';
    } else {
      params.push(parentId);
      q += ` AND d.parent_id = $${params.length}`;
    }
    q += ' ORDER BY d.position, d.created_at ASC';
    const rows = await pool.query(q, params);
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, parentId, icon, content } = req.body;
    const row = await pool.query(
      `INSERT INTO docs (org_id, parent_id, title, icon, content, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user!.orgId, parentId || null, title || 'Untitled', icon || '📄',
       content ? JSON.stringify(content) : null, req.user!.id]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await pool.query(
      `SELECT d.*, u.name as created_by_name FROM docs d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.id = $1 AND d.org_id = $2`,
      [req.params.id, req.user!.orgId]
    );
    if (!row.rows[0]) throw new AppError('Doc not found', 404);
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, content, icon, cover_url, is_favorite, position } = req.body;
    const row = await pool.query(
      `UPDATE docs SET
        title = COALESCE($1, title),
        content = COALESCE($2, content),
        icon = COALESCE($3, icon),
        cover_url = COALESCE($4, cover_url),
        is_favorite = COALESCE($5, is_favorite),
        position = COALESCE($6, position),
        updated_at = NOW()
       WHERE id = $7 AND org_id = $8 RETURNING *`,
      [title, content ? JSON.stringify(content) : undefined, icon, cover_url,
       is_favorite, position, req.params.id, req.user!.orgId]
    );
    if (!row.rows[0]) throw new AppError('Doc not found', 404);
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query(
      'UPDATE docs SET is_archived = TRUE WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user!.orgId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM docs WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function search(req: Request, res: Response, next: NextFunction) {
  try {
    const { q } = req.query;
    if (!q) { res.json([]); return; }
    const rows = await pool.query(
      `SELECT id, title, icon, updated_at FROM docs
       WHERE org_id = $1 AND is_archived = FALSE
       AND (title ILIKE $2 OR content::text ILIKE $2)
       ORDER BY updated_at DESC LIMIT 20`,
      [req.user!.orgId, `%${q}%`]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function getFavorites(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await pool.query(
      'SELECT id, title, icon, updated_at FROM docs WHERE org_id = $1 AND is_favorite = TRUE AND is_archived = FALSE ORDER BY updated_at DESC',
      [req.user!.orgId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
}
