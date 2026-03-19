import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

const VALID_SECTIONS = ['strategy', 'action_plan', 'shooting_plan', 'calendar'] as const;

/** GET /api/content-sections?clientId=xxx&section=strategy */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { clientId, section } = req.query as Record<string, string>;
    let q = `SELECT cs.*, u.name as created_by_name
             FROM content_sections cs
             LEFT JOIN users u ON u.id = cs.created_by
             WHERE cs.org_id = $1`;
    const params: any[] = [req.user!.orgId];
    if (clientId) { params.push(clientId); q += ` AND cs.client_id = $${params.length}`; }
    if (section)  { params.push(section);  q += ` AND cs.section = $${params.length}`; }
    q += ' ORDER BY cs.position ASC, cs.created_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) { next(err); }
}

/** POST /api/content-sections */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { clientId, section, title, body, status, position } = req.body;
    if (!clientId || !section || !title) throw new AppError('clientId, section, and title required', 400);
    if (!VALID_SECTIONS.includes(section)) throw new AppError('Invalid section type', 400);

    const { rows } = await pool.query(
      `INSERT INTO content_sections (org_id, client_id, section, title, body, status, position, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user!.orgId, clientId, section, title, body || null,
       status || 'draft', position ?? 0, req.user!.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

/** PATCH /api/content-sections/:id */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, body, status, position } = req.body;
    const { rows } = await pool.query(
      `UPDATE content_sections SET
         title = COALESCE($1, title), body = COALESCE($2, body),
         status = COALESCE($3, status), position = COALESCE($4, position),
         updated_at = NOW()
       WHERE id = $5 AND org_id = $6 RETURNING *`,
      [title, body, status, position, req.params.id, req.user!.orgId]
    );
    if (!rows[0]) throw new AppError('Not found', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
}

/** DELETE /api/content-sections/:id */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM content_sections WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}
