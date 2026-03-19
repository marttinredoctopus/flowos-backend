import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';

interface ActivityEntry {
  orgId: string;
  clientId?: string | null;
  actorId?: string | null;
  actorName?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  meta?: Record<string, any>;
}

export async function logActivity(entry: ActivityEntry): Promise<void> {
  await pool.query(
    `INSERT INTO activity_log (org_id, client_id, actor_id, actor_name, action, entity_type, entity_id, entity_name, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      entry.orgId,
      entry.clientId || null,
      entry.actorId || null,
      entry.actorName || null,
      entry.action,
      entry.entityType || null,
      entry.entityId || null,
      entry.entityName || null,
      JSON.stringify(entry.meta || {}),
    ]
  );
}

/**
 * GET /api/activity?clientId=xxx&limit=50
 * Returns activity timeline for a client
 */
export async function getClientActivity(req: Request, res: Response, next: NextFunction) {
  try {
    const { clientId, limit = '50' } = req.query as Record<string, string>;

    let where = 'WHERE a.org_id = $1';
    const params: any[] = [req.user!.orgId];

    if (clientId) {
      params.push(clientId);
      where += ` AND a.client_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT a.*,
              u.avatar_url as actor_avatar
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.actor_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${params.length + 1}`,
      [...params, parseInt(limit)]
    );

    res.json(rows);
  } catch (err) { next(err); }
}

/** ACTION ICON MAP for frontend */
export const ACTION_META: Record<string, { label: string; icon: string; color: string }> = {
  task_created:      { label: 'Task created',         icon: 'CheckSquare', color: '#6366f1' },
  task_completed:    { label: 'Task completed',        icon: 'CheckCircle', color: '#22c55e' },
  design_uploaded:   { label: 'Design uploaded',       icon: 'Palette',     color: '#8b5cf6' },
  design_approved:   { label: 'Design approved',       icon: 'ThumbsUp',    color: '#22c55e' },
  design_rejected:   { label: 'Changes requested',     icon: 'ThumbsDown',  color: '#f59e0b' },
  content_approved:  { label: 'Content approved',      icon: 'ThumbsUp',    color: '#22c55e' },
  content_rejected:  { label: 'Changes requested',     icon: 'ThumbsDown',  color: '#f59e0b' },
  comment_added:     { label: 'Comment added',         icon: 'MessageCircle', color: '#6366f1' },
  file_uploaded:     { label: 'File uploaded',         icon: 'FileText',    color: '#0ea5e9' },
  project_created:   { label: 'Project started',       icon: 'FolderKanban', color: '#6366f1' },
  invoice_sent:      { label: 'Invoice sent',          icon: 'Receipt',     color: '#f59e0b' },
};
