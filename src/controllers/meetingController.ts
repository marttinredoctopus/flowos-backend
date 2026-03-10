import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT m.*, c.name as client_name, p.name as project_name,
        u.name as created_by_name,
        ARRAY(SELECT user_id FROM meeting_attendees WHERE meeting_id = m.id) as attendee_ids
       FROM meetings m
       LEFT JOIN clients c ON c.id = m.client_id
       LEFT JOIN projects p ON p.id = m.project_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.org_id = $1 ORDER BY m.scheduled_at DESC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, meetingType, scheduledAt, durationMinutes, clientId, projectId, location, meetLink, attendees } = req.body;
    if (!title || !scheduledAt) throw new AppError('Title and scheduledAt are required', 400);
    const result = await pool.query(
      `INSERT INTO meetings (org_id, title, description, meeting_type, scheduled_at, duration_minutes, client_id, project_id, location, meet_link, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user!.orgId, title, description, meetingType || 'call', scheduledAt, durationMinutes || 60, clientId || null, projectId || null, location, meetLink, req.user!.id]
    );
    const meeting = result.rows[0];
    if (attendees?.length) {
      for (const uid of attendees) {
        await pool.query('INSERT INTO meeting_attendees VALUES ($1,$2) ON CONFLICT DO NOTHING', [meeting.id, uid]);
      }
    }
    res.status(201).json(meeting);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, status, scheduledAt, durationMinutes, location, meetLink } = req.body;
    const result = await pool.query(
      `UPDATE meetings SET
        title = COALESCE($1, title), description = COALESCE($2, description),
        status = COALESCE($3, status), scheduled_at = COALESCE($4, scheduled_at),
        duration_minutes = COALESCE($5, duration_minutes),
        location = COALESCE($6, location), meet_link = COALESCE($7, meet_link),
        updated_at = NOW()
       WHERE id = $8 AND org_id = $9 RETURNING *`,
      [title, description, status, scheduledAt, durationMinutes, location, meetLink, req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Meeting not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM meetings WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}
