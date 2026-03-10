import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';
import { pool } from '../config/database';

function getFileUrl(req: Request, filePath: string): string {
  const relative = path.relative(path.join(process.cwd(), env.UPLOAD_DIR), filePath);
  return `${req.protocol}://${req.get('host')}/uploads/${relative.replace(/\\/g, '/')}`;
}

function getFileType(mimetype: string): 'image' | 'video' | 'document' {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'document';
}

export async function listFiles(req: Request, res: Response): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT id, name as filename, size, mime_type, url, project_id, created_at
       FROM files WHERE org_id = $1 ORDER BY created_at DESC`,
      [(req as any).user?.orgId]
    );
    res.json(result.rows);
  } catch {
    res.json([]);
  }
}

export async function uploadSingle(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const url = getFileUrl(req, req.file.path);
  const user = (req as any).user;
  const projectId = req.body.projectId || null;

  try {
    const dbResult = await pool.query(
      `INSERT INTO files (org_id, user_id, project_id, name, size, mime_type, url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [user?.orgId, user?.id, projectId, req.file.originalname, req.file.size, req.file.mimetype, url]
    );
    res.json({
      id: dbResult.rows[0]?.id,
      url,
      filename: req.file.originalname,
      mime_type: req.file.mimetype,
      size: req.file.size,
      type: getFileType(req.file.mimetype),
    });
  } catch {
    res.json({
      url,
      filename: req.file.originalname,
      mime_type: req.file.mimetype,
      size: req.file.size,
      type: getFileType(req.file.mimetype),
    });
  }
}

export async function uploadMultiple(req: Request, res: Response): Promise<void> {
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const result = files.map((file) => ({
    url: getFileUrl(req, file.path),
    filename: file.filename,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    type: getFileType(file.mimetype),
  }));

  res.json(result);
}

export async function deleteFile(req: Request, res: Response): Promise<void> {
  const { filename } = req.params;

  // Prevent path traversal
  if (filename.includes('..') || filename.includes('/')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  // Search recursively for the file
  const uploadDir = path.join(process.cwd(), env.UPLOAD_DIR);
  let found = false;

  function findAndDelete(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findAndDelete(fullPath);
      } else if (entry.name === filename) {
        fs.unlinkSync(fullPath);
        found = true;
      }
    }
  }

  try {
    findAndDelete(uploadDir);
    if (found) {
      res.status(204).send();
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch {
    res.status(500).json({ error: 'Failed to delete file' });
  }
}
