import { pool } from '../config/database';
import { Server as SocketServer } from 'socket.io';

let io: SocketServer | null = null;

export function setSocketServer(server: SocketServer) {
  io = server;
}

export interface CreateNotificationInput {
  orgId?: string;
  recipientId: string;
  actorId?: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
}

export async function createNotification(data: CreateNotificationInput) {
  const res = await pool.query(
    `INSERT INTO notifications (org_id, recipient_id, actor_id, type, title, body, entity_type, entity_id, action_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [data.orgId, data.recipientId, data.actorId, data.type, data.title, data.body, data.entityType, data.entityId, data.actionUrl]
  );
  const notif = res.rows[0];

  if (io) {
    io.to(`user:${data.recipientId}`).emit('notification:new', notif);
    const count = await getUnreadCount(data.recipientId);
    io.to(`user:${data.recipientId}`).emit('notification:count', { count });
  }

  return notif;
}

export async function getNotifications(userId: string, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const rows = await pool.query(
    `SELECT n.*, u.name as actor_name, u.avatar_url as actor_avatar
     FROM notifications n
     LEFT JOIN users u ON u.id = n.actor_id
     WHERE n.recipient_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  const countRes = await pool.query(
    'SELECT COUNT(*) FROM notifications WHERE recipient_id = $1 AND is_read = FALSE',
    [userId]
  );
  return { notifications: rows.rows, unreadCount: parseInt(countRes.rows[0].count) };
}

export async function markAsRead(id: string, userId: string) {
  await pool.query(
    'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1 AND recipient_id = $2',
    [id, userId]
  );
}

export async function markAllAsRead(userId: string) {
  await pool.query(
    'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE recipient_id = $1 AND is_read = FALSE',
    [userId]
  );
  if (io) io.to(`user:${userId}`).emit('notification:count', { count: 0 });
}

export async function deleteNotification(id: string, userId: string) {
  await pool.query('DELETE FROM notifications WHERE id = $1 AND recipient_id = $2', [id, userId]);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const res = await pool.query(
    'SELECT COUNT(*) FROM notifications WHERE recipient_id = $1 AND is_read = FALSE',
    [userId]
  );
  return parseInt(res.rows[0].count);
}

// Trigger helpers
export async function triggerTaskAssigned(task: any, assigneeId: string, actorId: string) {
  await createNotification({
    orgId: task.org_id,
    recipientId: assigneeId,
    actorId,
    type: 'task_assigned',
    title: 'New task assigned to you',
    body: task.title,
    entityType: 'task',
    entityId: task.id,
    actionUrl: `/dashboard/tasks/${task.id}`,
  });
}

export async function triggerTaskDueSoon(task: any) {
  if (!task.assignee_id) return;
  await createNotification({
    orgId: task.org_id,
    recipientId: task.assignee_id,
    type: 'task_due_soon',
    title: 'Task due tomorrow',
    body: task.title,
    entityType: 'task',
    entityId: task.id,
    actionUrl: `/dashboard/tasks/${task.id}`,
  });
}

export async function triggerTaskOverdue(task: any) {
  if (!task.assignee_id) return;
  await createNotification({
    orgId: task.org_id,
    recipientId: task.assignee_id,
    type: 'task_overdue',
    title: 'Task is overdue',
    body: task.title,
    entityType: 'task',
    entityId: task.id,
    actionUrl: `/dashboard/tasks/${task.id}`,
  });
}

export async function triggerCommentAdded(comment: any, task: any, actorId: string) {
  if (!task.assignee_id || task.assignee_id === actorId) return;
  await createNotification({
    orgId: task.org_id,
    recipientId: task.assignee_id,
    actorId,
    type: 'comment_added',
    title: 'New comment on your task',
    body: comment.body?.slice(0, 200),
    entityType: 'task',
    entityId: task.id,
    actionUrl: `/dashboard/tasks/${task.id}`,
  });
}

export async function triggerMentioned(recipientId: string, actorId: string, orgId: string, context: string, entityId: string) {
  await createNotification({
    orgId,
    recipientId,
    actorId,
    type: 'mentioned',
    title: 'You were mentioned',
    body: context?.slice(0, 200),
    entityType: 'task',
    entityId,
    actionUrl: `/dashboard/tasks/${entityId}`,
  });
}

export async function triggerProjectCompleted(project: any, recipientId: string) {
  await createNotification({
    orgId: project.org_id,
    recipientId,
    type: 'project_completed',
    title: 'Project completed!',
    body: project.name,
    entityType: 'project',
    entityId: project.id,
    actionUrl: `/dashboard/projects/${project.id}`,
  });
}
