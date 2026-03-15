import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

function generateApiKey(): string {
  return 'fos_live_' + crypto.randomBytes(24).toString('hex');
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT id, name, key_prefix, permissions, last_used_at, expires_at, is_active, created_at,
        (SELECT COUNT(*) FROM api_usage_logs WHERE api_key_id = ak.id AND created_at >= NOW() - INTERVAL '24 hours') as requests_today,
        (SELECT COUNT(*) FROM api_usage_logs WHERE api_key_id = ak.id AND created_at >= NOW() - INTERVAL '30 days') as requests_month
       FROM api_keys ak WHERE org_id = $1 ORDER BY created_at DESC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, permissions, expiresAt } = req.body;
    if (!name) throw new AppError('Name is required', 400);

    const plainKey = generateApiKey();
    const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex');
    const keyPrefix = plainKey.slice(0, 15) + '...';

    const result = await pool.query(
      `INSERT INTO api_keys (org_id, name, key_hash, key_prefix, permissions, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, key_prefix, permissions, expires_at, is_active, created_at`,
      [req.user!.orgId, name, keyHash, keyPrefix,
       JSON.stringify(permissions || ['read']), expiresAt || null, req.user!.id]
    );
    // Return plain key ONCE — never stored
    res.status(201).json({ ...result.rows[0], key: plainKey });
  } catch (err) { next(err); }
}

export async function revoke(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('UPDATE api_keys SET is_active = FALSE WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM api_keys WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}
