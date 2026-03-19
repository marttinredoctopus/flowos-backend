import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logActivity } from './activityController';

// ─── Design Briefs ────────────────────────────────────────────────────────────

export async function listBriefs(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, designerId, clientId } = req.query;
    let q = `SELECT db.*, u.name as designer_name, c.name as client_name, p.name as project_name
             FROM design_briefs db
             LEFT JOIN users u ON u.id = db.assigned_designer
             LEFT JOIN clients c ON c.id = db.client_id
             LEFT JOIN projects p ON p.id = db.project_id
             WHERE db.org_id = $1`;
    const params: any[] = [req.user!.orgId];
    if (status) { params.push(status); q += ` AND db.status = $${params.length}`; }
    if (designerId) { params.push(designerId); q += ` AND db.assigned_designer = $${params.length}`; }
    if (clientId) { params.push(clientId); q += ` AND db.client_id = $${params.length}`; }
    q += ' ORDER BY db.created_at DESC';
    const rows = await pool.query(q, params);
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function createBrief(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, projectId, clientId, assetType, assignedDesigner, deadline, briefContent } = req.body;
    if (!title) throw new AppError('Title required', 400);
    const row = await pool.query(
      `INSERT INTO design_briefs (org_id, title, project_id, client_id, asset_type, assigned_designer, deadline, brief_content, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user!.orgId, title, projectId || null, clientId || null,
       assetType || 'other', assignedDesigner || null, deadline || null,
       briefContent || null, req.user!.id]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function updateBrief(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, status, assignedDesigner, deadline, briefContent, assetType } = req.body;
    const row = await pool.query(
      `UPDATE design_briefs SET
        title = COALESCE($1, title), status = COALESCE($2, status),
        assigned_designer = COALESCE($3, assigned_designer), deadline = COALESCE($4, deadline),
        brief_content = COALESCE($5, brief_content), asset_type = COALESCE($6, asset_type),
        updated_at = NOW()
       WHERE id = $7 AND org_id = $8 RETURNING *`,
      [title, status, assignedDesigner, deadline, briefContent, assetType, req.params.id, req.user!.orgId]
    );
    if (!row.rows[0]) throw new AppError('Brief not found', 404);
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function deleteBrief(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM design_briefs WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

/**
 * POST /api/design/briefs/:id/approve
 * body: { approved: boolean, note?: string }
 */
export async function approveBrief(req: Request, res: Response, next: NextFunction) {
  try {
    const { approved, note } = req.body;
    const newStatus = approved ? 'client_approved' : 'revision_required';

    const row = await pool.query(
      `UPDATE design_briefs SET
         status = $1,
         approved_by = $2,
         approved_at = $3,
         rejection_note = $4,
         updated_at = NOW()
       WHERE id = $5 AND org_id = $6
       RETURNING *, (SELECT name FROM clients WHERE id = client_id) as client_name`,
      [newStatus, req.user!.id, approved ? new Date() : null,
       approved ? null : (note || null), req.params.id, req.user!.orgId]
    );
    if (!row.rows[0]) throw new AppError('Brief not found', 404);

    const brief = row.rows[0];

    // Notify assigned designer
    if (brief.assigned_designer) {
      await pool.query(
        `INSERT INTO notifications (org_id, recipient_id, actor_id, type, title, body, entity_type, entity_id, action_url)
         VALUES ($1,$2,$3,$4,$5,$6,'design',$7,$8)`,
        [req.user!.orgId, brief.assigned_designer, req.user!.id,
         approved ? 'design_approved' : 'design_rejected',
         approved ? `Design approved: ${brief.title}` : `Changes requested: ${brief.title}`,
         note || (approved ? 'Client approved your design.' : 'Client requested revisions.'),
         brief.id, `/dashboard/creative/design`]
      ).catch(() => {});
    }

    // Log activity
    await logActivity({
      orgId: req.user!.orgId, clientId: brief.client_id,
      actorId: req.user!.id, actorName: req.user!.name || 'Team',
      action: approved ? 'design_approved' : 'design_rejected',
      entityType: 'design', entityId: brief.id, entityName: brief.title,
      meta: { note },
    }).catch(() => {});

    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

// ─── Design Assets ────────────────────────────────────────────────────────────

export async function listAssets(req: Request, res: Response, next: NextFunction) {
  try {
    const { clientId, projectId, briefId } = req.query;
    let q = `SELECT da.*, u.name as uploaded_by_name
             FROM design_assets da LEFT JOIN users u ON u.id = da.uploaded_by
             WHERE da.org_id = $1`;
    const params: any[] = [req.user!.orgId];
    if (briefId) { params.push(briefId); q += ` AND da.brief_id = $${params.length}`; }
    if (clientId) { params.push(clientId); q += ` AND da.client_id = $${params.length}`; }
    if (projectId) { params.push(projectId); q += ` AND da.project_id = $${params.length}`; }
    q += ' ORDER BY da.created_at DESC';
    const rows = await pool.query(q, params);
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function uploadAsset(req: Request, res: Response, next: NextFunction) {
  try {
    const { briefId, projectId, clientId, taskId, name, fileUrl, fileType, r2Key, mimeType, sizeBytes } = req.body;
    if (!name || !fileUrl) throw new AppError('name and fileUrl required', 400);

    // Auto-increment version for same name + brief
    const existing = await pool.query(
      'SELECT MAX(version) as max_v FROM design_assets WHERE brief_id = $1 AND name = $2',
      [briefId || null, name]
    );
    const version = (existing.rows[0]?.max_v || 0) + 1;

    // Mark old versions as not current
    if (version > 1) {
      await pool.query(
        'UPDATE design_assets SET is_current = FALSE WHERE brief_id = $1 AND name = $2',
        [briefId, name]
      );
    }

    const row = await pool.query(
      `INSERT INTO design_assets
         (org_id, brief_id, project_id, client_id, task_id, name, file_url, file_type,
          version, uploaded_by, r2_key, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.user!.orgId, briefId || null, projectId || null, clientId || null,
       taskId || null, name, fileUrl, fileType || 'image', version, req.user!.id,
       r2Key || null, mimeType || null, sizeBytes || 0]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function getAssetVersions(req: Request, res: Response, next: NextFunction) {
  try {
    const asset = await pool.query('SELECT name, brief_id FROM design_assets WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    if (!asset.rows[0]) throw new AppError('Asset not found', 404);
    const versions = await pool.query(
      `SELECT da.*, u.name as uploaded_by_name FROM design_assets da
       LEFT JOIN users u ON u.id = da.uploaded_by
       WHERE da.name = $1 AND da.brief_id = $2 ORDER BY da.version DESC`,
      [asset.rows[0].name, asset.rows[0].brief_id]
    );
    res.json(versions.rows);
  } catch (err) { next(err); }
}

// ─── Design Feedback (Pin Comments) ──────────────────────────────────────────

export async function getFeedback(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await pool.query(
      `SELECT df.*, u.name as user_name FROM design_feedback df
       LEFT JOIN users u ON u.id = df.user_id
       WHERE df.asset_id = $1 ORDER BY df.pin_number ASC`,
      [req.params.assetId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function addFeedback(req: Request, res: Response, next: NextFunction) {
  try {
    const { xPercent, yPercent, comment } = req.body;
    if (xPercent === undefined || yPercent === undefined || !comment) {
      throw new AppError('xPercent, yPercent, and comment required', 400);
    }
    const countRes = await pool.query(
      'SELECT COUNT(*) FROM design_feedback WHERE asset_id = $1',
      [req.params.assetId]
    );
    const pinNumber = parseInt(countRes.rows[0].count) + 1;

    const row = await pool.query(
      `INSERT INTO design_feedback (asset_id, user_id, x_percent, y_percent, comment, pin_number)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.assetId, req.user!.id, xPercent, yPercent, comment, pinNumber]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function resolveFeedback(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await pool.query(
      'UPDATE design_feedback SET resolved = $1 WHERE id = $2 RETURNING *',
      [req.body.resolved !== false, req.params.feedbackId]
    );
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

// ─── Brand Guidelines ─────────────────────────────────────────────────────────

export async function getBrandGuidelines(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await pool.query(
      'SELECT * FROM brand_guidelines WHERE org_id = $1 AND client_id = $2',
      [req.user!.orgId, req.params.clientId]
    );
    res.json(row.rows[0] || null);
  } catch (err) { next(err); }
}

export async function upsertBrandGuidelines(req: Request, res: Response, next: NextFunction) {
  try {
    const { logoUrls, primaryColor, secondaryColor, accentColor, extraColors,
            primaryFont, secondaryFont, toneOfVoice, brandValues, doList, dontList } = req.body;

    const row = await pool.query(
      `INSERT INTO brand_guidelines
        (org_id, client_id, logo_urls, primary_color, secondary_color, accent_color, extra_colors,
         primary_font, secondary_font, tone_of_voice, brand_values, do_list, dont_list, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (org_id, client_id) DO UPDATE SET
        logo_urls = $3, primary_color = $4, secondary_color = $5, accent_color = $6,
        extra_colors = $7, primary_font = $8, secondary_font = $9, tone_of_voice = $10,
        brand_values = $11, do_list = $12, dont_list = $13, updated_at = NOW()
       RETURNING *`,
      [req.user!.orgId, req.params.clientId,
       JSON.stringify(logoUrls || []), primaryColor || null, secondaryColor || null,
       accentColor || null, JSON.stringify(extraColors || []),
       primaryFont || null, secondaryFont || null, toneOfVoice || null,
       brandValues || null, JSON.stringify(doList || []), JSON.stringify(dontList || [])]
    );
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}
