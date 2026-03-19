import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM projects WHERE client_id = c.id) as project_count
       FROM clients c
       WHERE c.org_id = $1 ORDER BY c.created_at DESC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, company, phone, website, brief, accounts, avatarUrl } = req.body;
    if (!name) throw new AppError('Name is required', 400);
    const result = await pool.query(
      `INSERT INTO clients (org_id, name, email, company, phone, website, brief, accounts, avatar_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user!.orgId, name, email, company, phone, website, brief, JSON.stringify(accounts || []), avatarUrl]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      'SELECT * FROM clients WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Client not found', 404);
    const projects = await pool.query(
      'SELECT id, name, status, color, progress FROM projects WHERE client_id = $1',
      [req.params.id]
    );
    res.json({ ...result.rows[0], projects: projects.rows });
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, company, phone, website, brief, accounts, avatarUrl } = req.body;
    const result = await pool.query(
      `UPDATE clients SET
        name = COALESCE($1, name), email = COALESCE($2, email),
        company = COALESCE($3, company), phone = COALESCE($4, phone),
        website = COALESCE($5, website), brief = COALESCE($6, brief),
        accounts = COALESCE($7, accounts),
        avatar_url = COALESCE($8, avatar_url)
       WHERE id = $9 AND org_id = $10 RETURNING *`,
      [name, email, company, phone, website, brief,
       accounts !== undefined ? JSON.stringify(accounts) : null,
       avatarUrl, req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Client not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM clients WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}
