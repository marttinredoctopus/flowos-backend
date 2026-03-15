import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT ac.*, c.name as client_name, p.name as project_name
       FROM ad_campaigns ac
       LEFT JOIN clients c ON c.id = ac.client_id
       LEFT JOIN projects p ON p.id = ac.project_id
       WHERE ac.org_id = $1 ORDER BY ac.created_at DESC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, platform, clientId, projectId, budget, startDate, endDate, status } = req.body;
    if (!name || !platform) throw new AppError('Name and platform are required', 400);
    const result = await pool.query(
      `INSERT INTO ad_campaigns (org_id, name, platform, client_id, project_id, budget, start_date, end_date, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user!.orgId, name, platform, clientId || null, projectId || null, budget || null, startDate || null, endDate || null, status || 'draft', req.user!.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, platform, status, budget, spent, impressions, clicks, conversions, startDate, endDate } = req.body;
    const result = await pool.query(
      `UPDATE ad_campaigns SET
        name = COALESCE($1, name), platform = COALESCE($2, platform),
        status = COALESCE($3, status), budget = COALESCE($4, budget),
        spent = COALESCE($5, spent), impressions = COALESCE($6, impressions),
        clicks = COALESCE($7, clicks), conversions = COALESCE($8, conversions),
        start_date = COALESCE($9, start_date), end_date = COALESCE($10, end_date),
        updated_at = NOW()
       WHERE id = $11 AND org_id = $12 RETURNING *`,
      [name, platform, status, budget, spent, impressions, clicks, conversions, startDate, endDate, req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Campaign not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM ad_campaigns WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}
