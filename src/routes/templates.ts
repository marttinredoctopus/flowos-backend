import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// ─── List templates ───────────────────────────────────────────────────────────
router.get('/', async (req: any, res, next) => {
  try {
    const { category } = req.query;
    let where = 'WHERE (t.org_id = $1 OR t.is_public = TRUE)';
    const params: any[] = [req.user.orgId];

    if (category) {
      params.push(category);
      where += ` AND t.category = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT t.*,
              u.name as created_by_name,
              (SELECT COUNT(*) FROM template_tasks tt WHERE tt.template_id = t.id) as task_count
       FROM project_templates t
       LEFT JOIN users u ON u.id = t.created_by
       ${where}
       ORDER BY t.use_count DESC, t.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── Get single template with tasks ──────────────────────────────────────────
router.get('/:id', async (req: any, res, next) => {
  try {
    const [tpl, tasks] = await Promise.all([
      pool.query(
        `SELECT t.*, u.name as created_by_name FROM project_templates t
         LEFT JOIN users u ON u.id = t.created_by
         WHERE t.id = $1 AND (t.org_id = $2 OR t.is_public = TRUE)`,
        [req.params.id, req.user.orgId]
      ),
      pool.query(
        `SELECT * FROM template_tasks WHERE template_id = $1 ORDER BY position`,
        [req.params.id]
      ),
    ]);
    if (!tpl.rows[0]) throw new AppError('Template not found', 404);
    res.json({ ...tpl.rows[0], tasks: tasks.rows });
  } catch (err) { next(err); }
});

// ─── Create template ──────────────────────────────────────────────────────────
router.post('/', async (req: any, res, next) => {
  try {
    const { name, description, category = 'General', color = '#7c6fe0', icon = '📋', isPublic = false, tasks = [] } = req.body;
    if (!name) throw new AppError('name is required', 400);

    const tplRes = await pool.query(
      `INSERT INTO project_templates (org_id, name, description, category, color, icon, is_public, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.orgId, name, description || null, category, color, icon, isPublic, req.user.id]
    );
    const tpl = tplRes.rows[0];

    // Insert tasks
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      await pool.query(
        `INSERT INTO template_tasks (template_id, title, description, priority, estimated_hours, position, offset_days, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tpl.id, t.title, t.description || null, t.priority || 'medium',
         t.estimated_hours || null, i, t.offset_days || 0, t.tags || null]
      );
    }

    res.status(201).json({ ...tpl, task_count: tasks.length });
  } catch (err) { next(err); }
});

// ─── Apply template → create project + tasks ─────────────────────────────────
router.post('/:id/apply', async (req: any, res, next) => {
  try {
    const { projectName, clientId, startDate, assigneeId } = req.body;
    if (!projectName) throw new AppError('projectName is required', 400);

    const tplRes = await pool.query(
      `SELECT * FROM project_templates WHERE id = $1 AND (org_id = $2 OR is_public = TRUE)`,
      [req.params.id, req.user.orgId]
    );
    if (!tplRes.rows[0]) throw new AppError('Template not found', 404);
    const tpl = tplRes.rows[0];

    const tasksRes = await pool.query(
      `SELECT * FROM template_tasks WHERE template_id = $1 ORDER BY position`,
      [req.params.id]
    );
    const templateTasks = tasksRes.rows;

    const base = startDate ? new Date(startDate) : new Date();

    // Create project
    const projRes = await pool.query(
      `INSERT INTO projects (org_id, name, client_id, status, color, created_by)
       VALUES ($1,$2,$3,'active',$4,$5) RETURNING *`,
      [req.user.orgId, projectName, clientId || null, tpl.color, req.user.id]
    );
    const project = projRes.rows[0];

    // Create tasks from template
    const createdTasks = [];
    for (const tt of templateTasks) {
      const dueDate = new Date(base.getTime() + tt.offset_days * 86400000);
      const taskRes = await pool.query(
        `INSERT INTO tasks
           (org_id, project_id, title, description, priority, estimated_hours, status,
            due_date, assignee_id, reporter_id, tags, position)
         VALUES ($1,$2,$3,$4,$5,$6,'todo',$7,$8,$9,$10,$11) RETURNING *`,
        [req.user.orgId, project.id, tt.title, tt.description || null,
         tt.priority, tt.estimated_hours || null,
         dueDate.toISOString().split('T')[0],
         assigneeId || null, req.user.id, tt.tags || null, tt.position]
      );
      createdTasks.push(taskRes.rows[0]);
    }

    // Increment template use count
    await pool.query(
      `UPDATE project_templates SET use_count = use_count + 1 WHERE id = $1`,
      [req.params.id]
    );

    res.status(201).json({
      project,
      tasks: createdTasks,
      message: `Project created with ${createdTasks.length} tasks from template "${tpl.name}"`,
    });
  } catch (err) { next(err); }
});

// ─── Update template ──────────────────────────────────────────────────────────
router.put('/:id', async (req: any, res, next) => {
  try {
    const { name, description, category, color, icon, isPublic, tasks } = req.body;
    const { rows } = await pool.query(
      `UPDATE project_templates SET
         name        = COALESCE($1, name),
         description = COALESCE($2, description),
         category    = COALESCE($3, category),
         color       = COALESCE($4, color),
         icon        = COALESCE($5, icon),
         is_public   = COALESCE($6, is_public),
         updated_at  = NOW()
       WHERE id = $7 AND org_id = $8 RETURNING *`,
      [name, description, category, color, icon,
       isPublic !== undefined ? isPublic : null,
       req.params.id, req.user.orgId]
    );
    if (!rows[0]) throw new AppError('Template not found', 404);

    if (tasks !== undefined) {
      await pool.query('DELETE FROM template_tasks WHERE template_id = $1', [req.params.id]);
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        await pool.query(
          `INSERT INTO template_tasks (template_id, title, description, priority, estimated_hours, position, offset_days)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [req.params.id, t.title, t.description || null,
           t.priority || 'medium', t.estimated_hours || null, i, t.offset_days || 0]
        );
      }
    }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── Delete template ──────────────────────────────────────────────────────────
router.delete('/:id', async (req: any, res, next) => {
  try {
    await pool.query('DELETE FROM project_templates WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
