import crypto from 'crypto';
import { pool } from '../config/database';

export type WebhookEvent =
  | 'task.created' | 'task.updated' | 'task.status_changed' | 'task.assigned' | 'task.completed' | 'task.deleted'
  | 'project.created' | 'project.updated' | 'project.completed' | 'project.deleted'
  | 'client.created' | 'client.updated'
  | 'invoice.created' | 'invoice.sent' | 'invoice.paid' | 'invoice.overdue'
  | 'comment.added' | 'member.added' | 'member.removed' | 'time_entry.logged';

export async function fireWebhook(orgId: string, event: WebhookEvent, data: any): Promise<void> {
  try {
    const hooks = await pool.query(
      `SELECT * FROM webhooks WHERE org_id = $1 AND is_active = TRUE AND events @> $2::jsonb`,
      [orgId, JSON.stringify([event])]
    );
    for (const hook of hooks.rows) {
      const payload = { event, timestamp: new Date().toISOString(), org_id: orgId, data };
      const deliveryRes = await pool.query(
        `INSERT INTO webhook_deliveries (webhook_id, org_id, event, payload, status) VALUES ($1,$2,$3,$4,'pending') RETURNING id`,
        [hook.id, orgId, event, payload]
      );
      // Fire and forget
      deliverWebhook(hook, payload, deliveryRes.rows[0].id, 0);
    }
  } catch (err) {
    console.error('[Webhook] Error firing webhook:', err);
  }
}

async function deliverWebhook(hook: any, payload: any, deliveryId: string, attempt: number): Promise<void> {
  const payloadStr = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', hook.secret).update(payloadStr).digest('hex');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FlowOS-Signature': signature,
        'X-FlowOS-Event': payload.event,
        'X-FlowOS-Delivery': deliveryId,
      },
      body: payloadStr,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseBody = await response.text().catch(() => '');
    await pool.query(
      `UPDATE webhook_deliveries SET status=$1, http_status=$2, response_body=$3, attempts=$4, delivered_at=$5 WHERE id=$6`,
      [response.ok ? 'delivered' : 'failed', response.status, responseBody.slice(0, 1000),
       attempt + 1, response.ok ? new Date() : null, deliveryId]
    );

    if (!response.ok && attempt < 2) {
      const delays = [60000, 300000, 1800000];
      await pool.query('UPDATE webhook_deliveries SET next_retry_at=$1 WHERE id=$2', [new Date(Date.now() + delays[attempt]), deliveryId]);
      setTimeout(() => deliverWebhook(hook, payload, deliveryId, attempt + 1), delays[attempt]);
    }
  } catch (err: any) {
    await pool.query(
      `UPDATE webhook_deliveries SET status='failed', response_body=$1, attempts=$2 WHERE id=$3`,
      [err.message?.slice(0, 500) || 'Network error', attempt + 1, deliveryId]
    );
    if (attempt < 2) {
      const delays = [60000, 300000, 1800000];
      setTimeout(() => deliverWebhook(hook, payload, deliveryId, attempt + 1), delays[attempt]);
    }
  }
}
