import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await pool.query(
      `SELECT f.*, u.name as created_by_name,
              (SELECT COUNT(*) FROM form_responses fr WHERE fr.form_id = f.id) as response_count
       FROM forms f LEFT JOIN users u ON u.id = f.created_by
       WHERE f.org_id = $1 ORDER BY f.created_at DESC`,
      [req.user!.orgId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, fields, settings } = req.body;
    if (!title) throw new AppError('Title required', 400);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uuidv4().slice(0, 6);
    const row = await pool.query(
      `INSERT INTO forms (org_id, title, description, fields, settings, slug, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user!.orgId, title, description || null,
       JSON.stringify(fields || []), JSON.stringify(settings || {}), slug, req.user!.id]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await pool.query(
      'SELECT * FROM forms WHERE (id = $1 OR slug = $1) AND org_id = $2',
      [req.params.id, req.user!.orgId]
    );
    if (!row.rows[0]) throw new AppError('Form not found', 404);
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, fields, settings } = req.body;
    const row = await pool.query(
      `UPDATE forms SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        fields = COALESCE($3, fields),
        settings = COALESCE($4, settings),
        updated_at = NOW()
       WHERE id = $5 AND org_id = $6 RETURNING *`,
      [title, description, fields ? JSON.stringify(fields) : undefined,
       settings ? JSON.stringify(settings) : undefined, req.params.id, req.user!.orgId]
    );
    if (!row.rows[0]) throw new AppError('Form not found', 404);
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM forms WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

// Public submission — no auth required
export async function submitResponse(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await pool.query('SELECT * FROM forms WHERE slug = $1', [req.params.slug]);
    if (!form.rows[0]) throw new AppError('Form not found', 404);

    await pool.query(
      'INSERT INTO form_responses (form_id, data, respondent_email) VALUES ($1,$2,$3)',
      [form.rows[0].id, JSON.stringify(req.body.data), req.body.email || null]
    );

    const settings = form.rows[0].settings || {};
    res.json({
      success: true,
      message: settings.thankYouMessage || 'Thank you for your response!',
      redirectUrl: settings.redirectUrl || null,
    });
  } catch (err) { next(err); }
}

export async function getResponses(req: Request, res: Response, next: NextFunction) {
  try {
    // Verify form belongs to org
    const form = await pool.query('SELECT id FROM forms WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    if (!form.rows[0]) throw new AppError('Form not found', 404);

    const rows = await pool.query(
      'SELECT * FROM form_responses WHERE form_id = $1 ORDER BY submitted_at DESC',
      [req.params.id]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
}
