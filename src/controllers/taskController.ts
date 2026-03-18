import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { triggerTaskAssigned, triggerCommentAdded } from '../services/notificationService';
import { queueEmail, sendTaskAssignedEmail } from '../services/emailService';
import { fireAutomations } from '../services/automationService';
import { env } from '../config/env';

async function getTaskAssignees(taskId: string) {
  const rows = await pool.query(
    `SELECT u.id, u.name, u.avatar_url, u.email FROM task_assignees ta
     JOIN users u ON u.id = ta.user_id WHERE ta.task_id = $1`,
    [taskId]
  );
  return rows.rows;
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, status, assigneeId } = req.query;
    let q = `SELECT t.*, u.name as assignee_name, u.avatar_url as assignee_avatar,
                    r.name as reporter_name,
                    p.name as project_name,
                    COALESCE(
                      (SELECT json_agg(json_build_object('id', u2.id, 'name', u2.name, 'avatar_url', u2.avatar_url))
                       FROM task_assignees ta JOIN users u2 ON u2.id = ta.user_id WHERE ta.task_id = t.id),
                      '[]'::json
                    ) as assignees
             FROM tasks t
             LEFT JOIN users u ON u.id = t.assignee_id
             LEFT JOIN users r ON r.id = t.reporter_id
             LEFT JOIN projects p ON p.id = t.project_id
             WHERE t.org_id = $1`;
    const params: any[] = [req.user!.orgId];
    if (projectId) { params.push(projectId); q += ` AND t.project_id = $${params.length}`; }
    if (status) { params.push(status); q += ` AND t.status = $${params.length}`; }
    if (assigneeId) {
      params.push(assigneeId);
      q += ` AND (t.assignee_id = $${params.length} OR EXISTS (SELECT 1 FROM task_assignees ta2 WHERE ta2.task_id = t.id AND ta2.user_id = $${params.length}))`;
    }
    q += ' ORDER BY t.position NULLS LAST, t.created_at DESC';
    const res2 = await pool.query(q, params);
    res.json(res2.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, title, description, status = 'todo', priority = 'medium',
            assigneeId, assigneeIds, dueDate, estimatedHours, tags, link, parentId } = req.body;
    if (!title) throw new AppError('Title is required', 400);

    const result = await pool.query(
      `INSERT INTO tasks (project_id, org_id, title, description, status, priority, assignee_id,
        reporter_id, due_date, estimated_hours, tags, link, parent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [projectId || null, req.user!.orgId, title, description || null, status, priority,
       assigneeId || null, req.user!.id, dueDate || null, estimatedHours || null,
       tags || null, link || null, parentId || null]
    );
    const task = result.rows[0];

    const toAssign: string[] = [];
    if (assigneeIds?.length) {
      for (const uid of assigneeIds) {
        await pool.query(
          'INSERT INTO task_assignees (task_id, user_id, assigned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [task.id, uid, req.user!.id]
        );
        toAssign.push(uid);
      }
    } else if (assigneeId) {
      await pool.query(
        'INSERT INTO task_assignees (task_id, user_id, assigned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [task.id, assigneeId, req.user!.id]
      );
      toAssign.push(assigneeId);
    }

    for (const uid of toAssign) {
      if (uid !== req.user!.id) {
        await triggerTaskAssigned(task, uid, req.user!.id);
        const userRow = await pool.query('SELECT name, email FROM users WHERE id = $1', [uid]);
        if (userRow.rows[0]) {
          const projectRow = projectId
            ? await pool.query('SELECT name FROM projects WHERE id = $1', [projectId])
            : null;
          queueEmail({
            template: 'task_assigned',
            to: userRow.rows[0].email,
            data: {
              name: userRow.rows[0].name,
              taskTitle: task.title,
              projectName: projectRow?.rows[0]?.name || 'No Project',
              priority: task.priority,
              dueDate: task.due_date ? new Date(task.due_date).toLocaleDateString() : undefined,
              taskUrl: `${env.FRONTEND_URL}/dashboard/tasks`,
            },
          }).catch(() => {});
        }
      }
    }

    // Fire task_created automations
    fireAutomations({ event: 'task_created', orgId: req.user!.orgId, actorId: req.user!.id, data: task }).catch(() => {});

    const assignees = await getTaskAssignees(task.id);
    res.status(201).json({ ...task, assignees });
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT t.*, u.name as assignee_name, u.avatar_url as assignee_avatar,
              r.name as reporter_name, r.avatar_url as reporter_avatar,
              p.name as project_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       LEFT JOIN users r ON r.id = t.reporter_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1 AND t.org_id = $2`,
      [req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Task not found', 404);
    const assignees = await getTaskAssignees(req.params.id);
    const subtasks = await pool.query(
      'SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.parent_id = $1',
      [req.params.id]
    );
    res.json({ ...result.rows[0], assignees, subtasks: subtasks.rows });
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, status, priority, assigneeId, assigneeIds,
            dueDate, due_date, estimatedHours, tags, tag, position, link, project_id } = req.body;
    const prev = await pool.query('SELECT * FROM tasks WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    if (!prev.rows[0]) throw new AppError('Task not found', 404);

    // Build SET clause dynamically so explicit null values clear the field
    const sets: string[] = ['updated_at = NOW()'];
    const vals: any[] = [];
    let n = 1;
    function addField(col: string, val: any) {
      if (val !== undefined) { sets.push(`${col} = $${n++}`); vals.push(val === '' ? null : val); }
    }
    addField('title',           title);
    addField('description',     description);
    addField('status',          status);
    addField('priority',        priority);
    addField('due_date',        due_date !== undefined ? due_date : dueDate);
    addField('estimated_hours', estimatedHours);
    addField('tags',            tags);
    addField('tag',             tag);
    addField('position',        position);
    addField('link',            link);
    addField('project_id',      project_id);
    if (assigneeId !== undefined) { sets.push(`assignee_id = $${n++}`); vals.push(assigneeId || null); }

    vals.push(req.params.id, req.user!.orgId);
    const result = await pool.query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${n++} AND org_id = $${n++} RETURNING *`,
      vals
    );
    const task = result.rows[0];
    if (!task) throw new AppError('Task not found', 404);

    // Sync task_assignees table
    if (assigneeIds !== undefined) {
      await pool.query('DELETE FROM task_assignees WHERE task_id = $1', [task.id]);
      for (const uid of assigneeIds) {
        await pool.query(
          'INSERT INTO task_assignees (task_id, user_id, assigned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [task.id, uid, req.user!.id]
        );
      }
    } else if (assigneeId !== undefined) {
      await pool.query('DELETE FROM task_assignees WHERE task_id = $1', [task.id]);
      if (assigneeId) {
        await pool.query(
          'INSERT INTO task_assignees (task_id, user_id, assigned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [task.id, assigneeId, req.user!.id]
        );
      }
    }

    if (assigneeId && assigneeId !== prev.rows[0].assignee_id && assigneeId !== req.user!.id) {
      await triggerTaskAssigned(task, assigneeId, req.user!.id);
      const userRow = await pool.query('SELECT name, email FROM users WHERE id = $1', [assigneeId]);
      if (userRow.rows[0]) {
        const projectRow = task.project_id
          ? await pool.query('SELECT name FROM projects WHERE id = $1', [task.project_id])
          : null;
        queueEmail({
          template: 'task_assigned',
          to: userRow.rows[0].email,
          data: {
            name: userRow.rows[0].name,
            taskTitle: task.title,
            projectName: projectRow?.rows[0]?.name || 'No Project',
            priority: task.priority,
            dueDate: task.due_date ? new Date(task.due_date).toLocaleDateString() : undefined,
            taskUrl: `${env.FRONTEND_URL}/dashboard/tasks`,
          },
        }).catch(() => {});
      }
    }

    // Fire automation events
    if (status && status !== prev.rows[0].status) {
      fireAutomations({ event: 'task_completed', orgId: req.user!.orgId, actorId: req.user!.id, data: task }).catch(() => {});
    }

    // Email reporter/creator when task is marked done
    const prevStatus = prev.rows[0].status;
    const isDone = (status === 'done' || status === 'completed') && prevStatus !== status;
    if (isDone && task.reporter_id && task.reporter_id !== req.user!.id) {
      const [reporterRow, actorRow] = await Promise.all([
        pool.query('SELECT name, email FROM users WHERE id = $1', [task.reporter_id]),
        pool.query('SELECT name FROM users WHERE id = $1', [req.user!.id]),
      ]);
      if (reporterRow.rows[0]?.email) {
        queueEmail({
          template: 'task_completed',
          to: reporterRow.rows[0].email,
          data: {
            name:        reporterRow.rows[0].name,
            completedBy: actorRow.rows[0]?.name || 'A team member',
            taskTitle:   task.title,
            taskUrl:     `${env.FRONTEND_URL}/dashboard/tasks`,
          },
        }).catch(() => {});
      }
    }

    const assignees = await getTaskAssignees(task.id);
    res.json({ ...task, assignees });
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function addComment(req: Request, res: Response, next: NextFunction) {
  try {
    const { body: bodyField, text, mentions = [] } = req.body;
    const body = text || bodyField;
    if (!body?.trim()) throw new AppError('Comment body required', 400);
    const taskRes = await pool.query('SELECT * FROM tasks WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    if (!taskRes.rows[0]) throw new AppError('Task not found', 404);
    const task = taskRes.rows[0];

    const result = await pool.query(
      'INSERT INTO comments (task_id, user_id, body, mentions) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.id, req.user!.id, body.trim(), JSON.stringify(mentions)]
    );
    const comment = result.rows[0];

    // Send mention notifications
    for (const mentionedId of mentions) {
      if (mentionedId !== req.user!.id) {
        await triggerCommentAdded(comment, task, req.user!.id).catch(() => {});
      }
    }

    const actorRow = await pool.query('SELECT name FROM users WHERE id = $1', [req.user!.id]);
    const actorName = actorRow.rows[0]?.name || 'Someone';

    const notifyIds = new Set<string>();
    if (task.assignee_id && task.assignee_id !== req.user!.id) notifyIds.add(task.assignee_id);
    if (task.reporter_id && task.reporter_id !== req.user!.id) notifyIds.add(task.reporter_id);
    const assignees = await getTaskAssignees(task.id);
    for (const a of assignees) {
      if (a.id !== req.user!.id) notifyIds.add(a.id);
    }

    for (const recipientId of notifyIds) {
      await triggerCommentAdded(comment, task, req.user!.id);
      const recipientRow = await pool.query('SELECT name, email FROM users WHERE id = $1', [recipientId]);
      if (recipientRow.rows[0]) {
        queueEmail({
          template: 'comment_notification',
          to: recipientRow.rows[0].email,
          data: {
            name: recipientRow.rows[0].name,
            actorName,
            taskTitle: task.title,
            comment: body.slice(0, 200),
            replyUrl: `${env.FRONTEND_URL}/dashboard/tasks`,
          },
        }).catch(() => {});
      }
    }

    const fullComment = await pool.query(
      `SELECT c.*, u.name, u.avatar_url,
              json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url) as user
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
      [comment.id]
    );
    res.status(201).json(fullComment.rows[0]);
  } catch (err) { next(err); }
}

export async function getComments(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT c.*, u.name, u.avatar_url,
              json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url) as user
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.task_id = $1 ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}
