import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM projects WHERE client_id = c.id) as project_count,
        (SELECT COUNT(*) FROM tasks WHERE client_id = c.id) as task_count
       FROM clients c
       WHERE c.org_id = $1 ORDER BY c.created_at DESC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, company, phone, website, brief, accounts, avatarUrl } = req.body;
    if (!name) throw new AppError('Name is required', 400);
    const result = await pool.query(
      `INSERT INTO clients (org_id, name, email, company, phone, website, brief, accounts, avatar_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user!.orgId, name, email, company, phone, website, brief, JSON.stringify(accounts || []), avatarUrl]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgId = req.user!.orgId;

    const clientRes = await pool.query(
      'SELECT * FROM clients WHERE id = $1 AND org_id = $2',
      [id, orgId]
    );
    if (!clientRes.rows[0]) throw new AppError('Client not found', 404);

    const [projects, tasks, designs, content, files] = await Promise.all([
      pool.query(
        `SELECT id, name, status, color, progress, start_date, end_date, service_type
         FROM projects WHERE client_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      pool.query(
        `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.client_id,
                p.name as project_name, p.id as project_id,
                u.name as assignee_name, u.avatar_url as assignee_avatar
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.client_id = $1 OR (t.project_id IN (SELECT id FROM projects WHERE client_id = $1))
         ORDER BY t.created_at DESC LIMIT 100`,
        [id]
      ),
      pool.query(
        `SELECT id, title, asset_type, status, deadline, brief_content, assigned_designer
         FROM design_briefs WHERE client_id = $1 AND org_id = $2
         ORDER BY created_at DESC`,
        [id, orgId]
      ),
      pool.query(
        `SELECT id, title, platform, content_type, status, publish_at, caption
         FROM content_pieces WHERE client_id = $1 AND org_id = $2
         ORDER BY created_at DESC`,
        [id, orgId]
      ),
      pool.query(
        `SELECT id, filename, public_url, mime_type, size_bytes, folder, created_at,
                uploaded_by
         FROM org_files
         WHERE entity_type = 'client' AND entity_id = $1 AND org_id = $2
         ORDER BY created_at DESC`,
        [id, orgId]
      ),
    ]);

    res.json({
      ...clientRes.rows[0],
      projects: projects.rows,
      tasks: tasks.rows,
      designs: designs.rows,
      content: content.rows,
      files: files.rows,
    });
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, company, phone, website, brief, accounts, avatarUrl } = req.body;
    const result = await pool.query(
      `UPDATE clients SET
        name = COALESCE($1, name), email = COALESCE($2, email),
        company = COALESCE($3, company), phone = COALESCE($4, phone),
        website = COALESCE($5, website), brief = COALESCE($6, brief),
        accounts = COALESCE($7, accounts),
        avatar_url = COALESCE($8, avatar_url)
       WHERE id = $9 AND org_id = $10 RETURNING *`,
      [name, email, company, phone, website, brief,
       accounts !== undefined ? JSON.stringify(accounts) : null,
       avatarUrl, req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Client not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM clients WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

/** Generate / refresh share token for client portal */
export async function generateShareToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { expiresInDays, portalEnabled } = req.body;

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400 * 1000).toISOString()
      : null;

    const result = await pool.query(
      `UPDATE clients SET
         share_token = gen_random_uuid(),
         share_token_expires_at = $1,
         portal_enabled = $2
       WHERE id = $3 AND org_id = $4
       RETURNING share_token, share_token_expires_at, portal_enabled`,
      [expiresAt, portalEnabled ?? true, id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Client not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

/** Public portal endpoint — accessed via share token, no auth required */
export async function getPortalByToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.params;
    const result = await pool.query(
      `SELECT c.id, c.name, c.company, c.avatar_url, c.portal_enabled,
              c.share_token_expires_at
       FROM clients c WHERE c.share_token = $1`,
      [token]
    );
    const client = result.rows[0];
    if (!client) throw new AppError('Portal not found', 404);
    if (!client.portal_enabled) throw new AppError('Portal is disabled', 403);
    if (client.share_token_expires_at && new Date(client.share_token_expires_at) < new Date()) {
      throw new AppError('Portal link has expired', 410);
    }

    const [projects, content] = await Promise.all([
      pool.query(
        `SELECT id, name, status, progress FROM projects WHERE client_id = $1`,
        [client.id]
      ),
      pool.query(
        `SELECT id, title, platform, status, publish_at FROM content_pieces
         WHERE client_id = $1 ORDER BY publish_at DESC LIMIT 20`,
        [client.id]
      ),
    ]);

    res.json({ client, projects: projects.rows, content: content.rows });
  } catch (err) { next(err); }
}
