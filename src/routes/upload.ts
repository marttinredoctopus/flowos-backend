import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth';
import { uploadToR2, deleteFromR2, getPresignedUploadUrl } from '../services/storageService';
import {
  checkQuota, addStorageUsage, removeStorageUsage,
  PLAN_FILE_SIZE, PLAN_STORAGE, formatBytes,
} from '../services/storageQuota';
import { pool } from '../config/database';

const router = Router();
router.use(authMiddleware);

// Memory storage — stream to R2 instead of writing to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB hard cap
});

// ── POST /api/upload/single ─────────────────────────────────────────────────
// Primary upload endpoint (backwards-compatible with existing pages)
router.post('/single', upload.single('file'), async (req: any, res): Promise<void> => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No file provided' }); return; }

    const folder      = req.body.folder      || 'files';
    const entityType  = req.body.entityType  || req.body.entity_type  || null;
    const entityId    = req.body.entityId    || req.body.entity_id    || null;
    const orgId       = req.user.orgId;

    // Quota + plan checks
    const quota = await checkQuota(orgId, file.size);
    const maxSize = PLAN_FILE_SIZE[quota.plan] || PLAN_FILE_SIZE.free;

    if (file.size > maxSize) {
      res.status(403).json({
        error: `Your ${quota.plan} plan allows files up to ${formatBytes(maxSize)}. This file is ${formatBytes(file.size)}.`,
        code: 'FILE_TOO_LARGE',
        upgrade_url: '/dashboard/settings',
      }); return;
    }

    if (!quota.allowed) {
      res.status(403).json({
        error: `Storage full. You have ${formatBytes(quota.remaining)} remaining of your ${formatBytes(quota.limit)} limit.`,
        code: 'STORAGE_QUOTA_EXCEEDED',
        upgrade_url: '/dashboard/settings',
      }); return;
    }

    // Upload to R2
    const result = await uploadToR2({
      buffer:   file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      orgId,
      folder,
    });

    // Save record
    await pool.query(
      `INSERT INTO org_files
         (org_id, uploaded_by, r2_key, public_url, filename, mime_type, size_bytes, folder, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [orgId, req.user.id, result.key, result.url,
       file.originalname, file.mimetype, file.size,
       folder, entityType, entityId]
    );

    // Update storage counter
    await addStorageUsage(orgId, file.size);

    res.json({
      url:       result.url,
      key:       result.key,
      filename:  file.originalname,
      mime_type: file.mimetype,
      size:      file.size,
    });
  } catch (err: any) {
    console.error('[Upload] single error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ── POST /api/upload/multiple ───────────────────────────────────────────────
router.post('/multiple', upload.array('files', 20), async (req: any, res): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) { res.status(400).json({ error: 'No files provided' }); return; }

    const folder = req.body.folder || 'files';
    const orgId  = req.user.orgId;
    const results = [];

    for (const file of files) {
      const quota   = await checkQuota(orgId, file.size);
      if (!quota.allowed) break; // stop if full

      const result = await uploadToR2({
        buffer: file.buffer, filename: file.originalname,
        mimeType: file.mimetype, orgId, folder,
      });

      await pool.query(
        `INSERT INTO org_files (org_id, uploaded_by, r2_key, public_url, filename, mime_type, size_bytes, folder)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [orgId, req.user.id, result.key, result.url, file.originalname, file.mimetype, file.size, folder]
      );
      await addStorageUsage(orgId, file.size);

      results.push({ url: result.url, key: result.key, filename: file.originalname,
        mime_type: file.mimetype, size: file.size });
    }

    res.json(results);
  } catch (err: any) {
    console.error('[Upload] multiple error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ── DELETE /api/upload ──────────────────────────────────────────────────────
// Delete by R2 key
router.delete('/', async (req: any, res): Promise<void> => {
  try {
    const key = req.body.key;
    if (!key) { res.status(400).json({ error: 'key is required' }); return; }

    const { rows } = await pool.query(
      'SELECT * FROM org_files WHERE r2_key = $1 AND org_id = $2',
      [key, req.user.orgId]
    );
    if (!rows[0]) { res.status(404).json({ error: 'File not found' }); return; }

    await deleteFromR2(key);
    await pool.query('DELETE FROM org_files WHERE r2_key = $1', [key]);
    await removeStorageUsage(req.user.orgId, rows[0].size_bytes);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[Upload] delete error:', err);
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

// ── DELETE /api/upload/:filename ────────────────────────────────────────────
// Legacy endpoint — try to match by filename in org_files, or try R2 key directly
router.delete('/:filename', async (req: any, res): Promise<void> => {
  try {
    const { filename } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM org_files WHERE (filename = $1 OR r2_key LIKE $2) AND org_id = $3 LIMIT 1`,
      [filename, `%${filename}`, req.user.orgId]
    );

    if (rows[0]) {
      await deleteFromR2(rows[0].r2_key);
      await pool.query('DELETE FROM org_files WHERE id = $1', [rows[0].id]);
      await removeStorageUsage(req.user.orgId, rows[0].size_bytes);
      res.status(204).send(); return;
    }
    res.status(404).json({ error: 'File not found' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

// ── GET /api/upload/list ────────────────────────────────────────────────────
router.get('/list', async (req: any, res) => {
  try {
    const folder = req.query.folder as string | undefined;
    const params: any[] = [req.user.orgId];
    let sql = `SELECT id, filename, public_url AS url, mime_type, size_bytes AS size,
                      folder, entity_type, entity_id, created_at
               FROM org_files WHERE org_id = $1`;
    if (folder) { sql += ' AND folder = $2'; params.push(folder); }
    sql += ' ORDER BY created_at DESC LIMIT 100';

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch {
    res.json([]);
  }
});

// ── GET /api/upload/usage ───────────────────────────────────────────────────
router.get('/usage', async (req: any, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(storage_used_bytes, 0) AS storage_used_bytes, plan
       FROM organizations WHERE id = $1`,
      [req.user.orgId]
    );
    const org   = rows[0] || {};
    const plan  = org.plan || 'free';
    const used  = Number(org.storage_used_bytes || 0);
    const limit = PLAN_STORAGE[plan] || PLAN_STORAGE.free;
    const pct   = Math.round((used / limit) * 100);

    res.json({
      used_bytes:      used,
      limit_bytes:     limit,
      used_formatted:  formatBytes(used),
      limit_formatted: formatBytes(limit),
      percentage:      pct,
      plan,
      is_near_full:    pct >= 80,
      is_full:         pct >= 100,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/upload/presigned ───────────────────────────────────────────────
router.get('/presigned', async (req: any, res): Promise<void> => {
  try {
    const { filename, mime_type, folder, file_size } = req.query as Record<string, string>;
    if (!filename || !mime_type) {
      res.status(400).json({ error: 'filename and mime_type are required' }); return;
    }

    const quota = await checkQuota(req.user.orgId, Number(file_size || 0));
    if (!quota.allowed) {
      res.status(403).json({
        error: `Storage full. ${formatBytes(quota.remaining)} remaining.`,
        code: 'STORAGE_QUOTA_EXCEEDED',
      }); return;
    }

    const { uploadUrl, key, publicUrl } = await getPresignedUploadUrl({
      orgId:    req.user.orgId,
      filename,
      mimeType: mime_type,
      folder:   folder || 'files',
    });

    res.json({ upload_url: uploadUrl, key, public_url: publicUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/upload/test ────────────────────────────────────────────────────
// Verify R2 connection
router.get('/test', async (req: any, res) => {
  try {
    const testBuffer = Buffer.from('TasksDone R2 test - ' + new Date().toISOString());
    const result = await uploadToR2({
      buffer:   testBuffer,
      filename: 'connection-test.txt',
      mimeType: 'text/plain',
      orgId:    req.user.orgId,
      folder:   'test',
    });

    await deleteFromR2(result.key);

    res.json({
      success: true,
      message: 'R2 connection working ✅',
      bucket:  process.env.R2_BUCKET_NAME,
      public_url_prefix: process.env.R2_PUBLIC_URL,
    });
  } catch (err: any) {
    res.json({
      success: false,
      error:   err.message,
      hint:    'Check R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_KEY in Railway variables',
    });
  }
});

export default router;
