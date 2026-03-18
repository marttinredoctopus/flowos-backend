import { Request, Response, NextFunction } from 'express';
import { query, queryOne } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const ContentSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().optional(),
  platform: z.enum(['instagram', 'twitter', 'facebook', 'linkedin', 'tiktok', 'youtube']),
  post_type: z.enum(['post', 'story', 'reel', 'video', 'thread']),
  status: z.enum(['draft', 'scheduled', 'published']).default('draft'),
  scheduled_at: z.string().datetime().optional().nullable(),
  media_urls: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export async function listContent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { year, month, platform, status } = req.query;

    let sql = `
      SELECT * FROM content_posts
      WHERE workspace_id = $1
    `;
    const params: any[] = [req.user!.orgId];
    let idx = 2;

    if (year && month) {
      sql += ` AND EXTRACT(YEAR FROM COALESCE(scheduled_at, created_at)) = $${idx++}`;
      params.push(Number(year));
      sql += ` AND EXTRACT(MONTH FROM COALESCE(scheduled_at, created_at)) = $${idx++}`;
      params.push(Number(month));
    }

    if (platform) {
      sql += ` AND platform = $${idx++}`;
      params.push(platform);
    }

    if (status) {
      sql += ` AND status = $${idx++}`;
      params.push(status);
    }

    sql += ` ORDER BY COALESCE(scheduled_at, created_at) ASC`;

    const posts = await query(sql, params);
    res.json(posts);
  } catch (err) { next(err); }
}

export async function getContent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const post = await queryOne(
      'SELECT * FROM content_posts WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.orgId]
    );

    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    res.json(post);
  } catch (err) { next(err); }
}

export async function createContent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = ContentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { title, body, platform, post_type, status, scheduled_at, media_urls, tags } = parsed.data;
    const id = uuidv4();

    const post = await queryOne(
      `INSERT INTO content_posts
        (id, workspace_id, created_by, title, body, platform, post_type, status, scheduled_at, media_urls, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        id,
        req.user!.orgId,
        req.user!.id,
        title,
        body ?? null,
        platform,
        post_type,
        status,
        scheduled_at ?? null,
        JSON.stringify(media_urls),
        JSON.stringify(tags),
      ]
    );

    res.status(201).json(post);
  } catch (err) { next(err); }
}

export async function updateContent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const existing = await queryOne(
      'SELECT id FROM content_posts WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user!.orgId]
    );

    if (!existing) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    const parsed = ContentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const fields = parsed.data;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        const dbValue = Array.isArray(value) ? JSON.stringify(value) : value;
        updates.push(`${key} = $${idx++}`);
        params.push(dbValue);
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = NOW()`);
    params.push(req.params.id, req.user!.orgId);

    const post = await queryOne(
      `UPDATE content_posts SET ${updates.join(', ')}
       WHERE id = $${idx++} AND workspace_id = $${idx++}
       RETURNING *`,
      params
    );

    res.json(post);
  } catch (err) { next(err); }
}

export async function deleteContent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await query(
      'DELETE FROM content_posts WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [req.params.id, req.user!.orgId]
    );

    if (result.length === 0) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    res.status(204).send();
  } catch (err) { next(err); }
}

export async function getCalendarView(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      res.status(400).json({ error: 'year and month are required' });
      return;
    }

    const posts = await query(
      `SELECT
         id, title, platform, post_type, status, scheduled_at, media_urls, tags
       FROM content_posts
       WHERE workspace_id = $1
         AND EXTRACT(YEAR FROM COALESCE(scheduled_at, created_at)) = $2
         AND EXTRACT(MONTH FROM COALESCE(scheduled_at, created_at)) = $3
       ORDER BY COALESCE(scheduled_at, created_at) ASC`,
      [req.user!.orgId, Number(year), Number(month)]
    );

    // Group by day
    const byDay: Record<number, any[]> = {};
    for (const post of posts) {
      const date = new Date(post.scheduled_at || post.created_at);
      const day = date.getDate();
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(post);
    }

    res.json({ year: Number(year), month: Number(month), byDay });
  } catch (err) { next(err); }
}
