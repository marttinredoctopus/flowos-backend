import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logActivity } from './activityController';

/**
 * GET /api/comments?entityType=task&entityId=xxx
 * Returns threaded comments for any entity
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { entityType, entityId } = req.query as Record<string, string>;
    if (!entityType || !entityId) throw new AppError('entityType and entityId required', 400);

    const { rows } = await pool.query(
      `SELECT c.*,
              u.name as author_name, u.avatar_url as author_avatar, u.role as author_role
       FROM comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.entity_type = $1 AND c.entity_id = $2
         AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC`,
      [entityType, entityId]
    );

    // Build tree structure: top-level + replies
    const top: any[] = [];
    const map: Record<string, any> = {};
    rows.forEach(r => { map[r.id] = { ...r, replies: [] }; });
    rows.forEach(r => {
      if (r.parent_id && map[r.parent_id]) {
        map[r.parent_id].replies.push(map[r.id]);
      } else {
        top.push(map[r.id]);
      }
    });

    res.json(top);
  } catch (err) { next(err); }
}

/**
 * POST /api/comments
 * body: { entityType, entityId, body, parentId?, mentions? }
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { entityType, entityId, body, parentId, mentions } = req.body;
    if (!entityType || !entityId || !body?.trim()) {
      throw new AppError('entityType, entityId, and body are required', 400);
    }

    const { rows } = await pool.query(
      `INSERT INTO comments (org_id, user_id, entity_type, entity_id, body, parent_id, mentions, task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user!.orgId,
        req.user!.id,
        entityType,
        entityId,
        body.trim(),
        parentId || null,
        JSON.stringify(mentions || []),
        entityType === 'task' ? entityId : null,
      ]
    );

    const comment = rows[0];

    // Fetch author details
    const userRes = await pool.query(
      'SELECT name, avatar_url, role FROM users WHERE id = $1',
      [req.user!.id]
    );
    const author = userRes.rows[0];

    // Log activity (best-effort)
    const clientIdRes = await resolveClientId(entityType, entityId);
    if (clientIdRes) {
      await logActivity({
        orgId: req.user!.orgId,
        clientId: clientIdRes,
        actorId: req.user!.id,
        actorName: author?.name || 'Team',
        action: 'comment_added',
        entityType,
        entityId,
        entityName: body.trim().slice(0, 60),
      }).catch(() => {});
    }

    res.status(201).json({
      ...comment,
      author_name: author?.name,
      author_avatar: author?.avatar_url,
      author_role: author?.role,
      replies: [],
    });
  } catch (err) { next(err); }
}

/**
 * DELETE /api/comments/:id  (soft delete, only own comments)
 */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `UPDATE comments SET deleted_at = NOW()
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, req.user!.id]
    );
    if (!result.rows[0]) throw new AppError('Comment not found', 404);
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function resolveClientId(entityType: string, entityId: string): Promise<string | null> {
  try {
    if (entityType === 'task') {
      const r = await pool.query(
        `SELECT p.client_id FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = $1`,
        [entityId]
      );
      return r.rows[0]?.client_id || null;
    }
    if (entityType === 'design') {
      const r = await pool.query('SELECT client_id FROM design_briefs WHERE id = $1', [entityId]);
      return r.rows[0]?.client_id || null;
    }
    if (entityType === 'content') {
      const r = await pool.query('SELECT client_id FROM content_pieces WHERE id = $1', [entityId]);
      return r.rows[0]?.client_id || null;
    }
    return null;
  } catch { return null; }
}
