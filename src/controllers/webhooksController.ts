import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { fireWebhook } from '../services/webhookService';

export const ALL_EVENTS = [
  'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.completed', 'task.deleted',
  'project.created', 'project.updated', 'project.completed', 'project.deleted',
  'client.created', 'client.updated',
  'invoice.created', 'invoice.sent', 'invoice.paid', 'invoice.overdue',
  'comment.added', 'member.added', 'member.removed', 'time_entry.logged',
];

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT w.*,
        (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id) as total_deliveries,
        (SELECT status FROM webhook_deliveries wd WHERE wd.webhook_id = w.id ORDER BY created_at DESC LIMIT 1) as last_status
       FROM webhooks w WHERE org_id = $1 ORDER BY created_at DESC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { url, events, isActive } = req.body;
    if (!url) throw new AppError('URL is required', 400);
    const secret = crypto.randomBytes(32).toString('hex');
    const result = await pool.query(
      `INSERT INTO webhooks (org_id, url, secret, events, is_active, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user!.orgId, url, secret, JSON.stringify(events || ALL_EVENTS), isActive !== false, req.user!.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { url, events, isActive } = req.body;
    const result = await pool.query(
      `UPDATE webhooks SET url=COALESCE($1,url), events=COALESCE($2,events), is_active=COALESCE($3,is_active)
       WHERE id=$4 AND org_id=$5 RETURNING *`,
      [url, events ? JSON.stringify(events) : null, isActive, req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Webhook not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM webhooks WHERE id=$1 AND org_id=$2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function testWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const hook = await pool.query('SELECT * FROM webhooks WHERE id=$1 AND org_id=$2', [req.params.id, req.user!.orgId]);
    if (!hook.rows[0]) throw new AppError('Webhook not found', 404);
    await fireWebhook(req.user!.orgId, 'task.created', {
      task: { id: 'test-id', title: 'Test Task', status: 'todo' },
      changed_by: { id: req.user!.id, name: 'Test User' },
    });
    res.json({ message: 'Test webhook fired' });
  } catch (err) { next(err); }
}

export async function getDeliveries(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT * FROM webhook_deliveries WHERE webhook_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}
