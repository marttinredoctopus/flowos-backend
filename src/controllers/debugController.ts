import { Request, Response, NextFunction } from 'express';
import { sendEmail } from '../services/emailService';
import { pool } from '../config/database';

export async function testEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const userRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [req.user!.id]);
    const user = userRes.rows[0];
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const result = await sendEmail({
      template: 'email_verification',
      to: user.email,
      data: { name: user.name, otp: '123456' },
    });

    res.json({ success: true, messageId: (result as any)?.messageId, to: user.email });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
}

export async function emailLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const logs = await pool.query(
      'SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 50'
    );
    res.json(logs.rows);
  } catch (err) { next(err); }
}

export async function emailStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { env } = await import('../config/env');
    const { emailQueue } = await import('../services/emailService');
    const waiting = await emailQueue.getWaiting();
    const lastLogs = await pool.query('SELECT * FROM email_logs ORDER BY sent_at DESC LIMIT 5').catch(() => ({ rows: [] }));
    res.json({
      provider: env.RESEND_API_KEY ? 'resend' : (env.SMTP_HOST ? 'smtp' : 'none'),
      configured: !!(env.RESEND_API_KEY || env.SMTP_HOST),
      queue_size: waiting.length,
      last_5_email_logs: lastLogs.rows,
    });
  } catch (err: any) {
    res.json({ error: err.message });
  }
}
