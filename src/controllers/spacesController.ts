import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

/* ─── LIST ─────────────────────────────────────────────────────── */
export async function listSpaces(req: Request, res: Response, next: NextFunction) {
  try {
    const { rows } = await pool.query(`
      SELECT s.*,
        c.name  AS client_name,
        c.email AS client_email,
        (SELECT COUNT(*) FROM projects  p WHERE p.space_id = s.id)::int AS project_count,
        (SELECT COUNT(*) FROM space_members sm WHERE sm.space_id = s.id)::int AS member_count,
        (SELECT COUNT(*) FROM tasks t JOIN projects p ON t.project_id = p.id WHERE p.space_id = s.id)::int AS task_count
      FROM spaces s
      LEFT JOIN clients c ON c.id = s.client_id
      WHERE s.org_id = $1
      ORDER BY s.created_at DESC
    `, [req.user!.orgId]);
    res.json({ spaces: rows });
  } catch (err) { next(err); }
}

/* ─── CREATE ────────────────────────────────────────────────────── */
export async function createSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, description, color, client_id, tov, brand_links } = req.body;
    if (!name?.trim()) throw new AppError('Space name required', 400);
    const { rows } = await pool.query(`
      INSERT INTO spaces (org_id, name, description, color, client_id, tov, brand_links, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [req.user!.orgId, name.trim(), description || null, color || '#7030EF',
        client_id || null, tov || null, JSON.stringify(brand_links || []), req.user!.id]);
    res.status(201).json({ space: rows[0] });
  } catch (err) { next(err); }
}

/* ─── GET ONE ───────────────────────────────────────────────────── */
export async function getSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT s.*,
        c.name AS client_name, c.email AS client_email,
        c.phone AS client_phone, c.website AS client_website,
        c.company AS client_company
      FROM spaces s
      LEFT JOIN clients c ON c.id = s.client_id
      WHERE s.id = $1 AND s.org_id = $2
    `, [id, req.user!.orgId]);
    if (!rows[0]) throw new AppError('Space not found', 404);

    const [membersRes, projectsRes, statsRes] = await Promise.all([
      pool.query(`
        SELECT u.id, u.name, u.email, u.avatar_url, u.role, sm.role AS space_role
        FROM space_members sm JOIN users u ON u.id = sm.user_id
        WHERE sm.space_id = $1
      `, [id]),
      pool.query(`
        SELECT p.*,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id)::int AS task_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done')::int AS done_count
        FROM projects p WHERE p.space_id = $1 ORDER BY p.created_at DESC
      `, [id]),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM tasks t JOIN projects p ON t.project_id=p.id WHERE p.space_id=$1)::int AS total_tasks,
          (SELECT COUNT(*) FROM tasks t JOIN projects p ON t.project_id=p.id WHERE p.space_id=$1 AND t.status='done')::int AS done_tasks,
          (SELECT COUNT(*) FROM space_assets WHERE space_id=$1)::int AS asset_count,
          (SELECT COUNT(*) FROM space_videos WHERE space_id=$1)::int AS video_count
      `, [id]),
    ]);

    res.json({
      space: rows[0],
      members: membersRes.rows,
      projects: projectsRes.rows,
      stats: statsRes.rows[0],
    });
  } catch (err) { next(err); }
}

/* ─── UPDATE ────────────────────────────────────────────────────── */
export async function updateSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, description, color, client_id, tov, brand_links, logo_url } = req.body;
    const { rows } = await pool.query(`
      UPDATE spaces SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        color       = COALESCE($3, color),
        client_id   = COALESCE($4, client_id),
        tov         = COALESCE($5, tov),
        brand_links = COALESCE($6, brand_links),
        logo_url    = COALESCE($7, logo_url),
        updated_at  = NOW()
      WHERE id = $8 AND org_id = $9
      RETURNING *
    `, [name, description, color, client_id, tov,
        brand_links ? JSON.stringify(brand_links) : null,
        logo_url, req.params.id, req.user!.orgId]);
    if (!rows[0]) throw new AppError('Space not found', 404);
    res.json({ space: rows[0] });
  } catch (err) { next(err); }
}

/* ─── DELETE ────────────────────────────────────────────────────── */
export async function deleteSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const { rows } = await pool.query(
      'DELETE FROM spaces WHERE id=$1 AND org_id=$2 RETURNING id',
      [req.params.id, req.user!.orgId]
    );
    if (!rows[0]) throw new AppError('Space not found', 404);
    res.json({ success: true });
  } catch (err) { next(err); }
}

/* ─── MEMBERS ───────────────────────────────────────────────────── */
export async function addMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { user_id, role = 'member' } = req.body;
    await pool.query(`
      INSERT INTO space_members (space_id, user_id, role)
      VALUES ($1,$2,$3) ON CONFLICT (space_id, user_id) DO UPDATE SET role = $3
    `, [req.params.id, user_id, role]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function removeMember(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query(
      'DELETE FROM space_members WHERE space_id=$1 AND user_id=$2',
      [req.params.id, req.params.userId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
}

/* ─── PROJECTS ──────────────────────────────────────────────────── */
export async function createSpaceProject(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, description, color, icon, status } = req.body;
    if (!name?.trim()) throw new AppError('Project name required', 400);

    // get client_id from space
    const sp = await pool.query('SELECT client_id FROM spaces WHERE id=$1 AND org_id=$2', [req.params.id, req.user!.orgId]);
    if (!sp.rows[0]) throw new AppError('Space not found', 404);

    const { rows } = await pool.query(`
      INSERT INTO projects (org_id, space_id, client_id, name, description, color, icon, status, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [req.user!.orgId, req.params.id, sp.rows[0].client_id,
        name.trim(), description || null, color || '#7030EF', icon || '📁',
        status || 'active', req.user!.id]);
    res.status(201).json({ project: rows[0] });
  } catch (err) { next(err); }
}

/* ─── TASKS (Kanban) ────────────────────────────────────────────── */
export async function getSpaceTasks(req: Request, res: Response, next: NextFunction) {
  try {
    const { rows } = await pool.query(`
      SELECT t.*, p.name AS project_name, p.color AS project_color,
        u.name AS assignee_name, u.avatar_url AS assignee_avatar
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE p.space_id = $1 AND p.org_id = $2
      ORDER BY t.created_at DESC
    `, [req.params.id, req.user!.orgId]);
    res.json({ tasks: rows });
  } catch (err) { next(err); }
}

export async function createSpaceTask(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, project_id, status, priority, due_date, description, assignee_id } = req.body;
    if (!title?.trim()) throw new AppError('Task title required', 400);
    if (!project_id) throw new AppError('Project required', 400);
    const { rows } = await pool.query(`
      INSERT INTO tasks (org_id, project_id, title, description, status, priority, due_date, assignee_id, reporter_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [req.user!.orgId, project_id, title.trim(), description || null,
        status || 'todo', priority || 'medium',
        due_date || null, assignee_id || null, req.user!.id]);
    res.status(201).json({ task: rows[0] });
  } catch (err) { next(err); }
}

/* ─── ASSETS ────────────────────────────────────────────────────── */
export async function listAssets(req: Request, res: Response, next: NextFunction) {
  try {
    const { type } = req.query;
    const params: any[] = [req.params.id, req.user!.orgId];
    let where = '';
    if (type && type !== 'all') { where = ' AND asset_type = $3'; params.push(type); }
    const { rows } = await pool.query(`
      SELECT a.*, u.name AS uploader_name
      FROM space_assets a LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.space_id = $1 AND a.org_id = $2${where}
      ORDER BY a.created_at DESC
    `, params);
    res.json({ assets: rows });
  } catch (err) { next(err); }
}

export async function createAsset(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, asset_type, file_url, link_url, mime_type, size_bytes, tags } = req.body;
    if (!name?.trim()) throw new AppError('Asset name required', 400);
    const { rows } = await pool.query(`
      INSERT INTO space_assets (space_id, org_id, name, asset_type, file_url, link_url, mime_type, size_bytes, tags, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [req.params.id, req.user!.orgId, name.trim(), asset_type || 'file',
        file_url || null, link_url || null, mime_type || null,
        size_bytes || null, tags || [], req.user!.id]);
    res.status(201).json({ asset: rows[0] });
  } catch (err) { next(err); }
}

export async function deleteAsset(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query(
      'DELETE FROM space_assets WHERE id=$1 AND space_id=$2 AND org_id=$3',
      [req.params.assetId, req.params.id, req.user!.orgId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
}

/* ─── VIDEOS ────────────────────────────────────────────────────── */
export async function listVideos(req: Request, res: Response, next: NextFunction) {
  try {
    const { rows } = await pool.query(`
      SELECT v.*, u.name AS assignee_name, u.avatar_url AS assignee_avatar
      FROM space_videos v LEFT JOIN users u ON u.id = v.assigned_to
      WHERE v.space_id = $1 AND v.org_id = $2
      ORDER BY v.created_at DESC
    `, [req.params.id, req.user!.orgId]);
    res.json({ videos: rows });
  } catch (err) { next(err); }
}

export async function createVideo(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, caption, tov, subtitles, video_url, video_link, reference_links, assigned_to } = req.body;
    if (!title?.trim()) throw new AppError('Video title required', 400);
    const { rows } = await pool.query(`
      INSERT INTO space_videos (space_id, org_id, title, description, caption, tov, subtitles, video_url, video_link, reference_links, assigned_to, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [req.params.id, req.user!.orgId, title.trim(), description || null,
        caption || null, tov || null, subtitles || null,
        video_url || null, video_link || null,
        JSON.stringify(reference_links || []),
        assigned_to || null, req.user!.id]);
    res.status(201).json({ video: rows[0] });
  } catch (err) { next(err); }
}

export async function updateVideo(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, description, caption, tov, subtitles, video_url, video_link, reference_links, assigned_to, status } = req.body;
    const { rows } = await pool.query(`
      UPDATE space_videos SET
        title           = COALESCE($1, title),
        description     = COALESCE($2, description),
        caption         = COALESCE($3, caption),
        tov             = COALESCE($4, tov),
        subtitles       = COALESCE($5, subtitles),
        video_url       = COALESCE($6, video_url),
        video_link      = COALESCE($7, video_link),
        reference_links = COALESCE($8, reference_links),
        assigned_to     = COALESCE($9, assigned_to),
        status          = COALESCE($10, status),
        updated_at      = NOW()
      WHERE id=$11 AND space_id=$12 AND org_id=$13
      RETURNING *
    `, [title, description, caption, tov, subtitles, video_url, video_link,
        reference_links ? JSON.stringify(reference_links) : null,
        assigned_to, status, req.params.videoId, req.params.id, req.user!.orgId]);
    if (!rows[0]) throw new AppError('Video not found', 404);
    res.json({ video: rows[0] });
  } catch (err) { next(err); }
}

export async function deleteVideo(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query(
      'DELETE FROM space_videos WHERE id=$1 AND space_id=$2 AND org_id=$3',
      [req.params.videoId, req.params.id, req.user!.orgId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
}
