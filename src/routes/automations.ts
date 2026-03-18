import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// ─── List automations ─────────────────────────────────────────────────────────
router.get('/', async (req: any, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.name as created_by_name,
              (SELECT COUNT(*) FROM automation_logs al WHERE al.automation_id = a.id) as total_runs,
              (SELECT COUNT(*) FROM automation_logs al WHERE al.automation_id = a.id AND al.status = 'failed') as failed_runs
       FROM automations a LEFT JOIN users u ON u.id = a.created_by
       WHERE a.org_id = $1 ORDER BY a.created_at DESC`,
      [req.user.orgId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── Create automation ────────────────────────────────────────────────────────
router.post('/', async (req: any, res, next) => {
  try {
    const { name, description, triggerEvent, triggerFilters = {}, actionType, actionConfig = {} } = req.body;
    if (!name)         throw new AppError('name is required', 400);
    if (!triggerEvent) throw new AppError('triggerEvent is required', 400);
    if (!actionType)   throw new AppError('actionType is required', 400);

    const VALID_TRIGGERS = [
      'task_completed', 'task_created', 'task_overdue',
      'client_created', 'invoice_created', 'invoice_paid',
      'project_created', 'project_completed',
    ];
    const VALID_ACTIONS = ['send_email', 'create_task', 'create_notification', 'send_webhook'];

    if (!VALID_TRIGGERS.includes(triggerEvent)) throw new AppError(`Invalid triggerEvent`, 400);
    if (!VALID_ACTIONS.includes(actionType))    throw new AppError(`Invalid actionType`, 400);

    const { rows } = await pool.query(
      `INSERT INTO automations (org_id, name, description, trigger_event, trigger_filters, action_type, action_config, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.orgId, name, description || null,
       triggerEvent, JSON.stringify(triggerFilters),
       actionType, JSON.stringify(actionConfig),
       req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ─── Update automation ────────────────────────────────────────────────────────
router.put('/:id', async (req: any, res, next) => {
  try {
    const { name, description, isActive, actionConfig, triggerFilters } = req.body;
    const { rows } = await pool.query(
      `UPDATE automations SET
         name            = COALESCE($1, name),
         description     = COALESCE($2, description),
         is_active       = COALESCE($3, is_active),
         action_config   = COALESCE($4, action_config),
         trigger_filters = COALESCE($5, trigger_filters),
         updated_at      = NOW()
       WHERE id = $6 AND org_id = $7 RETURNING *`,
      [name, description,
       isActive !== undefined ? isActive : null,
       actionConfig ? JSON.stringify(actionConfig) : null,
       triggerFilters ? JSON.stringify(triggerFilters) : null,
       req.params.id, req.user.orgId]
    );
    if (!rows[0]) throw new AppError('Automation not found', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── Toggle active/inactive ───────────────────────────────────────────────────
router.patch('/:id/toggle', async (req: any, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE automations SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [req.params.id, req.user.orgId]
    );
    if (!rows[0]) throw new AppError('Automation not found', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── Delete automation ────────────────────────────────────────────────────────
router.delete('/:id', async (req: any, res, next) => {
  try {
    await pool.query('DELETE FROM automations WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Get automation logs ──────────────────────────────────────────────────────
router.get('/:id/logs', async (req: any, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM automation_logs
       WHERE automation_id = $1
       ORDER BY ran_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
