import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name as client_name, u.name as manager_name
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       LEFT JOIN users u ON u.id = p.manager_id
       WHERE p.org_id = $1 ORDER BY p.created_at DESC`,
      [req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, description, clientId, serviceType, startDate, endDate, budget, managerId, color, teamMembers } = req.body;
    if (!name) throw new AppError('Name is required', 400);
    const result = await pool.query(
      `INSERT INTO projects (org_id, name, description, client_id, service_type, start_date, end_date, budget, manager_id, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user!.orgId, name, description, clientId, serviceType, startDate, endDate, budget, managerId || req.user!.id, color || '#4f8cff']
    );
    const project = result.rows[0];
    // Add team members
    if (teamMembers?.length) {
      for (const uid of teamMembers) {
        await pool.query(
          'INSERT INTO project_members (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [project.id, uid]
        );
      }
    }
    // Always add manager
    await pool.query(
      'INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [project.id, project.manager_id, 'manager']
    );
    res.status(201).json(project);
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name as client_name, u.name as manager_name,
              (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
              (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'done') as done_count
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       LEFT JOIN users u ON u.id = p.manager_id
       WHERE p.id = $1 AND p.org_id = $2`,
      [req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Project not found', 404);

    const members = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_url, pm.role
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [req.params.id]
    );
    res.json({ ...result.rows[0], members: members.rows });
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, description, status, clientId, serviceType, startDate, endDate, budget, managerId, color } = req.body;
    const result = await pool.query(
      `UPDATE projects SET
        name = COALESCE($1, name), description = COALESCE($2, description),
        status = COALESCE($3, status), client_id = COALESCE($4, client_id),
        service_type = COALESCE($5, service_type), start_date = COALESCE($6, start_date),
        end_date = COALESCE($7, end_date), budget = COALESCE($8, budget),
        manager_id = COALESCE($9, manager_id), color = COALESCE($10, color),
        updated_at = NOW()
       WHERE id = $11 AND org_id = $12 RETURNING *`,
      [name, description, status, clientId, serviceType, startDate, endDate, budget, managerId, color, req.params.id, req.user!.orgId]
    );
    if (!result.rows[0]) throw new AppError('Project not found', 404);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM projects WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function getTasks(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT t.*, u.name as assignee_name, u.avatar_url as assignee_avatar
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.project_id = $1 AND t.org_id = $2 ORDER BY t.position, t.created_at`,
      [req.params.id, req.user!.orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

export async function addMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, role = 'member' } = req.body;
    await pool.query(
      'INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3',
      [req.params.id, userId, role]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
}
