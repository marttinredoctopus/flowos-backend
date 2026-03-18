import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { randomBytes } from 'crypto';

const router = Router();
router.use(authenticate);

// ─── GET /api/client-portal/dashboard ─────────────────────────────────────────
// Returns data for the logged-in user's client or a specific clientId
router.get('/dashboard', async (req: any, res, next) => {
  try {
    const orgId    = req.user.orgId;
    const clientId = req.query.clientId as string | undefined;

    // If admin/manager viewing a specific client, use that clientId
    // If client role user, find their client record by user email
    let resolvedClientId = clientId;
    if (!resolvedClientId && req.user.role === 'client') {
      const clientRes = await pool.query(
        `SELECT id FROM clients WHERE org_id = $1 AND email = $2`,
        [orgId, req.user.email]
      );
      resolvedClientId = clientRes.rows[0]?.id;
    }

    if (!resolvedClientId) {
      res.json({ projects: [], tasks: [], invoices: [], designs: [], stats: {} });
      return;
    }

    const [projects, tasks, invoices, designs] = await Promise.all([
      pool.query(
        `SELECT p.*, COUNT(t.id) as task_count,
                COUNT(t.id) FILTER (WHERE t.status = 'done') as done_count
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.id
         WHERE p.org_id = $1 AND p.client_id = $2
         GROUP BY p.id ORDER BY p.created_at DESC`,
        [orgId, resolvedClientId]
      ),
      pool.query(
        `SELECT t.*, p.name as project_name FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.org_id = $1 AND p.client_id = $2
         ORDER BY t.due_date NULLS LAST, t.created_at DESC`,
        [orgId, resolvedClientId]
      ),
      pool.query(
        `SELECT * FROM invoices WHERE org_id = $1 AND client_id = $2
         ORDER BY created_at DESC`,
        [orgId, resolvedClientId]
      ),
      pool.query(
        `SELECT da.*, db.title as brief_title FROM design_assets da
         LEFT JOIN design_briefs db ON db.id = da.brief_id
         WHERE da.org_id = $1 AND da.client_id = $2 AND da.is_current = TRUE
         ORDER BY da.created_at DESC LIMIT 20`,
        [orgId, resolvedClientId]
      ),
    ]);

    const stats = {
      totalProjects:    projects.rows.length,
      activeProjects:   projects.rows.filter((p: any) => p.status === 'active').length,
      completedTasks:   tasks.rows.filter((t: any) => t.status === 'done').length,
      pendingTasks:     tasks.rows.filter((t: any) => t.status !== 'done').length,
      totalInvoiced:    invoices.rows.reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0),
      paidInvoices:     invoices.rows.filter((i: any) => i.status === 'paid').length,
      pendingInvoices:  invoices.rows.filter((i: any) => ['sent', 'overdue'].includes(i.status)).length,
    };

    res.json({
      clientId: resolvedClientId,
      stats,
      projects:  projects.rows,
      tasks:     tasks.rows,
      invoices:  invoices.rows,
      designs:   designs.rows,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/client-portal/designs ──────────────────────────────────────────
router.get('/designs', async (req: any, res, next) => {
  try {
    const { clientId, status } = req.query as Record<string, string>;
    const params: any[] = [req.user.orgId];
    let where = 'WHERE da.org_id = $1';

    if (clientId) { params.push(clientId); where += ` AND da.client_id = $${params.length}`; }
    if (status)   { params.push(status);   where += ` AND da.status = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT da.*, db.title as brief_title, db.status as brief_status,
              u.name as uploaded_by_name
       FROM design_assets da
       LEFT JOIN design_briefs db ON db.id = da.brief_id
       LEFT JOIN users u ON u.id = da.uploaded_by
       ${where}
       ORDER BY da.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── POST /api/client-portal/designs/:assetId/approve ────────────────────────
router.post('/designs/:assetId/approve', async (req: any, res, next) => {
  try {
    const { approved, feedback } = req.body; // approved: boolean
    const asset = await pool.query(
      `SELECT da.*, db.title as brief_title FROM design_assets da
       LEFT JOIN design_briefs db ON db.id = da.brief_id
       WHERE da.id = $1 AND da.org_id = $2`,
      [req.params.assetId, req.user.orgId]
    );
    if (!asset.rows[0]) throw new AppError('Design not found', 404);

    const status = approved ? 'approved' : 'rejected';

    // Update brief status if asset was approved/rejected
    if (asset.rows[0].brief_id) {
      await pool.query(
        `UPDATE design_briefs SET status = $1, updated_at = NOW() WHERE id = $2`,
        [approved ? 'client_approved' : 'revision_required', asset.rows[0].brief_id]
      );
    }

    // Add feedback pin if comment provided
    if (feedback) {
      await pool.query(
        `INSERT INTO design_feedback (asset_id, user_id, x_percent, y_percent, comment, pin_number)
         VALUES ($1,$2,50,50,$3,1)
         ON CONFLICT DO NOTHING`,
        [req.params.assetId, req.user.id, feedback]
      );
    }

    // Create notification for the uploader
    if (asset.rows[0].uploaded_by) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, action_url)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          asset.rows[0].uploaded_by,
          approved ? 'client_approved' : 'task_rejected',
          `Design ${approved ? 'approved' : 'rejected'}: ${asset.rows[0].name}`,
          feedback || (approved ? 'Client approved your design!' : 'Client requested revisions.'),
          `/dashboard/creative/design`,
        ]
      );
    }

    res.json({ success: true, status, assetId: req.params.assetId });
  } catch (err) { next(err); }
});

// ─── GET /api/client-portal/invoices ─────────────────────────────────────────
router.get('/invoices', async (req: any, res, next) => {
  try {
    const { clientId } = req.query as Record<string, string>;
    const params: any[] = [req.user.orgId];
    let where = 'WHERE i.org_id = $1';
    if (clientId) { params.push(clientId); where += ` AND i.client_id = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT i.*, c.name as client_name, c.email as client_email
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
       ${where} ORDER BY i.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── GET /api/client-portal/generate-link ────────────────────────────────────
// Generate a shareable client portal link
router.post('/generate-link', async (req: any, res, next) => {
  try {
    const { clientId } = req.body;
    if (!clientId) throw new AppError('clientId is required', 400);

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await pool.query(
      `INSERT INTO client_portal_tokens (org_id, client_id, token, expires_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [req.user.orgId, clientId, token, expiresAt]
    );

    const baseUrl = process.env.FRONTEND_URL || 'https://tasksdone.cloud';
    res.json({
      url:        `${baseUrl}/client-portal/${token}`,
      token,
      expires_at: expiresAt,
    });
  } catch (err) { next(err); }
});

export default router;
