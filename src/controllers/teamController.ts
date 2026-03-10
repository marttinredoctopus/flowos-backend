import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, avatar_url, is_active, last_seen_at, created_at
       FROM users WHERE org_id = $1 AND is_active = TRUE ORDER BY created_at ASC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function invite(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, name, role = 'member' } = req.body;
    if (!email || !name) throw new AppError('Email and name are required', 400);
    if (!['admin', 'member', 'viewer'].includes(role)) throw new AppError('Invalid role', 400);
    // Check existing
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) throw new AppError('User with this email already exists', 409);
    // Create user with temp password
    const bcrypt = await import('bcrypt');
    const tempPassword = Math.random().toString(36).slice(-10);
    const hash = await bcrypt.hash(tempPassword, 10);
    const result = await pool.query(
      `INSERT INTO users (org_id, name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, created_at`,
      [req.user!.orgId, name, email, hash, role]
    );
    res.status(201).json({ ...result.rows[0], tempPassword });
  } catch (err) { next(err); }
}

export async function updateMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { role, isActive } = req.body;
    if (req.user!.role !== 'admin') throw new AppError('Admin only', 403);
    const result = await pool.query(
      `UPDATE users SET
        role = COALESCE($1, role),
        is_active = COALESCE($2, is_active),
        updated_at = NOW()
       WHERE id = $3 AND org_id = $4 RETURNING id, name, email, role, is_active`,
      [role, isActive, req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Member not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function removeMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'admin') throw new AppError('Admin only', 403);
    if (req.params.id === req.user!.id) throw new AppError('Cannot remove yourself', 400);
    await pool.query(
      'UPDATE users SET is_active = FALSE WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user!.orgId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
}
