import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { platform, status, clientId, month, year } = req.query;
    let q = `SELECT cp.*,
              uw.name as writer_name, ud.name as designer_name, c.name as client_name, p.name as project_name
             FROM content_pieces cp
             LEFT JOIN users uw ON uw.id = cp.assigned_writer
             LEFT JOIN users ud ON ud.id = cp.assigned_designer
             LEFT JOIN clients c ON c.id = cp.client_id
             LEFT JOIN projects p ON p.id = cp.project_id
             WHERE cp.org_id = $1`;
    const params: any[] = [req.user!.orgId];
    if (platform) { params.push(platform); q += ` AND cp.platform = $${params.length}`; }
    if (status) { params.push(status); q += ` AND cp.status = $${params.length}`; }
    if (clientId) { params.push(clientId); q += ` AND cp.client_id = $${params.length}`; }
    if (month && year) {
      q += ` AND EXTRACT(MONTH FROM cp.publish_at) = $${params.length + 1} AND EXTRACT(YEAR FROM cp.publish_at) = $${params.length + 2}`;
      params.push(month, year);
    }
    q += ' ORDER BY cp.publish_at ASC NULLS LAST, cp.created_at DESC';
    const rows = await pool.query(q, params);
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, platform, contentType, status, assignedWriter, assignedDesigner,
            publishAt, caption, mediaUrls, clientId, projectId, notes } = req.body;
    if (!title) throw new AppError('Title required', 400);
    const row = await pool.query(
      `INSERT INTO content_pieces (org_id, title, platform, content_type, status, assigned_writer,
        assigned_designer, publish_at, caption, media_urls, client_id, project_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user!.orgId, title, platform || 'instagram', contentType || 'post',
       status || 'draft', assignedWriter || null, assignedDesigner || null,
       publishAt || null, caption || null, JSON.stringify(mediaUrls || []),
       clientId || null, projectId || null, notes || null, req.user!.id]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, platform, contentType, status, assignedWriter, assignedDesigner,
            publishAt, caption, mediaUrls, notes } = req.body;
    const row = await pool.query(
      `UPDATE content_pieces SET
        title = COALESCE($1, title), platform = COALESCE($2, platform),
        content_type = COALESCE($3, content_type), status = COALESCE($4, status),
        assigned_writer = COALESCE($5, assigned_writer), assigned_designer = COALESCE($6, assigned_designer),
        publish_at = COALESCE($7, publish_at), caption = COALESCE($8, caption),
        media_urls = COALESCE($9, media_urls), notes = COALESCE($10, notes),
        updated_at = NOW()
       WHERE id = $11 AND org_id = $12 RETURNING *`,
      [title, platform, contentType, status, assignedWriter, assignedDesigner,
       publishAt, caption, mediaUrls ? JSON.stringify(mediaUrls) : undefined,
       notes, req.params.id, req.user!.orgId]
    );
    if (!row.rows[0]) throw new AppError('Content piece not found', 404);
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM content_pieces WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

// Copy bank
export async function listCopyBank(req: Request, res: Response, next: NextFunction) {
  try {
    const { platform, contentType, clientId, q } = req.query;
    let sql = `SELECT cb.*, u.name as created_by_name, c.name as client_name
               FROM copy_bank cb
               LEFT JOIN users u ON u.id = cb.created_by
               LEFT JOIN clients c ON c.id = cb.client_id
               WHERE cb.org_id = $1`;
    const params: any[] = [req.user!.orgId];
    if (platform) { params.push(platform); sql += ` AND cb.platform = $${params.length}`; }
    if (contentType) { params.push(contentType); sql += ` AND cb.content_type = $${params.length}`; }
    if (clientId) { params.push(clientId); sql += ` AND cb.client_id = $${params.length}`; }
    if (q) { params.push(`%${q}%`); sql += ` AND cb.caption ILIKE $${params.length}`; }
    sql += ' ORDER BY cb.created_at DESC';
    const rows = await pool.query(sql, params);
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function addToCopyBank(req: Request, res: Response, next: NextFunction) {
  try {
    const { caption, platform, contentType, tone, hashtags, performanceLabel, clientId } = req.body;
    if (!caption) throw new AppError('Caption required', 400);
    const row = await pool.query(
      `INSERT INTO copy_bank (org_id, client_id, platform, content_type, tone, caption, hashtags, performance_label, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user!.orgId, clientId || null, platform || null, contentType || null,
       tone || null, caption, hashtags || [], performanceLabel || null, req.user!.id]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function removeCopyBankItem(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM copy_bank WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}
