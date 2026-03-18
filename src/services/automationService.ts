import { pool } from '../config/database';
import { queueEmail } from './emailService';
import { env } from '../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TriggerEvent =
  | 'task_completed'
  | 'task_created'
  | 'task_overdue'
  | 'client_created'
  | 'invoice_created'
  | 'invoice_paid'
  | 'project_created'
  | 'project_completed';

export type ActionType =
  | 'send_email'
  | 'create_task'
  | 'create_notification'
  | 'send_webhook';

export interface AutomationTriggerPayload {
  event:    TriggerEvent;
  orgId:    string;
  actorId?: string;
  data:     Record<string, any>;
}

// ─── Fire automations matching a trigger event ────────────────────────────────

export async function fireAutomations(payload: AutomationTriggerPayload): Promise<void> {
  try {
    const { rows: rules } = await pool.query(
      `SELECT * FROM automations
       WHERE org_id = $1 AND trigger_event = $2 AND is_active = TRUE`,
      [payload.orgId, payload.event]
    );

    for (const rule of rules) {
      try {
        const matches = checkFilters(rule.trigger_filters, payload.data);
        if (!matches) {
          await logRun(rule.id, payload.orgId, 'skipped', payload.data, { reason: 'filters did not match' });
          continue;
        }
        const result = await executeAction(rule, payload);
        await pool.query(
          `UPDATE automations SET run_count = run_count + 1, last_run_at = NOW() WHERE id = $1`,
          [rule.id]
        );
        await logRun(rule.id, payload.orgId, 'success', payload.data, result);
      } catch (err: any) {
        await logRun(rule.id, payload.orgId, 'failed', payload.data, null, err.message);
        console.error(`[Automation] Rule ${rule.id} failed:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[Automation] fireAutomations error:', err.message);
  }
}

// ─── Filter evaluation ─────────────────────────────────────────────────────────

function checkFilters(filters: Record<string, any>, data: Record<string, any>): boolean {
  if (!filters || Object.keys(filters).length === 0) return true;

  for (const [key, expected] of Object.entries(filters)) {
    const actual = data[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (typeof expected === 'object' && expected !== null) {
      if (expected.$not !== undefined && actual === expected.$not) return false;
      if (expected.$in  !== undefined && !expected.$in.includes(actual)) return false;
      if (expected.$gte !== undefined && !(actual >= expected.$gte)) return false;
      if (expected.$lte !== undefined && !(actual <= expected.$lte)) return false;
    } else {
      if (actual !== expected) return false;
    }
  }
  return true;
}

// ─── Action execution ─────────────────────────────────────────────────────────

async function executeAction(
  rule: any,
  payload: AutomationTriggerPayload
): Promise<any> {
  const cfg = rule.action_config as Record<string, any>;

  switch (rule.action_type as ActionType) {
    case 'send_email': {
      const recipientRes = await pool.query(
        `SELECT name, email FROM users WHERE org_id = $1 AND id = $2`,
        [payload.orgId, cfg.recipient_id || payload.actorId]
      );
      const recipient = recipientRes.rows[0];
      if (!recipient?.email) return { skipped: 'no recipient email' };

      const subject = interpolate(cfg.subject || 'TasksDone Notification', payload.data);
      const body    = interpolate(cfg.body    || 'An automation was triggered.', payload.data);

      await queueEmail({
        template: 'welcome' as any,
        to:       recipient.email,
        data:     { name: recipient.name, orgName: subject } as any,
      });
      return { sent_to: recipient.email };
    }

    case 'create_task': {
      const title = interpolate(cfg.title || 'Automated Task', payload.data);
      const result = await pool.query(
        `INSERT INTO tasks (org_id, title, description, status, priority, assignee_id, due_date, project_id, reporter_id)
         VALUES ($1,$2,$3,'todo',$4,$5,$6,$7,$8) RETURNING id`,
        [
          payload.orgId,
          title,
          interpolate(cfg.description || '', payload.data),
          cfg.priority || 'medium',
          cfg.assignee_id || payload.actorId || null,
          cfg.due_offset_days
            ? new Date(Date.now() + cfg.due_offset_days * 86400000).toISOString().split('T')[0]
            : null,
          cfg.project_id || payload.data.project_id || null,
          payload.actorId || null,
        ]
      );
      return { task_id: result.rows[0].id };
    }

    case 'create_notification': {
      const title = interpolate(cfg.title || 'Automation triggered', payload.data);
      const body  = interpolate(cfg.body  || '', payload.data);

      const targets = cfg.notify_all_admins
        ? await pool.query(
            `SELECT id FROM users WHERE org_id = $1 AND role IN ('admin','manager')`,
            [payload.orgId]
          ).then(r => r.rows.map((x: any) => x.id))
        : cfg.user_ids || (payload.actorId ? [payload.actorId] : []);

      for (const uid of targets) {
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, body, action_url)
           VALUES ($1,$2,$3,$4,$5)`,
          [uid, payload.event, title, body, cfg.action_url || null]
        );
      }
      return { notified: targets.length };
    }

    case 'send_webhook': {
      const webhookUrl = cfg.url;
      if (!webhookUrl) return { skipped: 'no webhook url' };

      const webhookRes = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-TasksDone-Event': payload.event },
        body:    JSON.stringify({ event: payload.event, data: payload.data, org_id: payload.orgId }),
      });
      return { status: webhookRes.status };
    }

    default:
      return { error: `Unknown action type: ${rule.action_type}` };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function interpolate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ''));
}

async function logRun(
  automationId: string,
  orgId:        string,
  status:       'success' | 'failed' | 'skipped',
  triggerData:  any,
  result:       any,
  error?:       string
): Promise<void> {
  await pool.query(
    `INSERT INTO automation_logs (automation_id, org_id, status, trigger_data, result, error)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [automationId, orgId, status, JSON.stringify(triggerData), JSON.stringify(result), error || null]
  ).catch(() => {});
}
