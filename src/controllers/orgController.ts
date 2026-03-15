import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function getOrgSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query('SELECT * FROM organizations WHERE id=$1', [req.user!.orgId]);
    res.json(result.rows[0] || {});
  } catch (err) { return next(err); }
}

export async function updateOrgSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, logoUrl, timezone, language } = req.body;
    const result = await pool.query(
      `UPDATE organizations SET
        name = COALESCE($1, name),
        logo_url = COALESCE($2, logo_url),
        timezone = COALESCE($3, timezone),
        language = COALESCE($4, language)
       WHERE id = $5 RETURNING *`,
      [name, logoUrl, timezone, language, req.user!.orgId]
    );
    res.json(result.rows[0] || {});
  } catch (err) { return next(err); }
}

export async function listTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, avatar_url, job_title, phone, created_at, last_seen_at as last_active
       FROM users WHERE org_id=$1 ORDER BY created_at ASC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { return next(err); }
}

export async function updateMemberRole(req: Request, res: Response, next: NextFunction) {
  try {
    const { role } = req.body;
    if (!['admin', 'manager', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin, manager, or member.' });
    }
    await pool.query('UPDATE users SET role=$1 WHERE id=$2 AND org_id=$3', [role, req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { return next(err); }
}

export async function removeMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.params.id === req.user!.id) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }
    await pool.query('DELETE FROM users WHERE id=$1 AND org_id=$2 AND role != $3', [req.params.id, req.user!.orgId, 'admin']);
    res.json({ success: true });
  } catch (err) { return next(err); }
}
