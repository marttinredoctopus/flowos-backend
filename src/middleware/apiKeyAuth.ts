import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../config/database';
import { redis } from '../config/redis';

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const headerKey = req.headers['x-api-key'] as string | undefined;
    const authHeader = req.headers.authorization;
    const apiKey = headerKey ||
      (authHeader?.startsWith('Bearer fos_') ? authHeader.slice(7) : null);

    if (!apiKey) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'API key required. Use X-API-Key header or Bearer token.' } });
    }

    // Rate limiting: 1000 req/hour per key prefix
    const rateLimitKey = `ratelimit:${apiKey.slice(0, 20)}`;
    const requests = await redis.incr(rateLimitKey);
    if (requests === 1) await redis.expire(rateLimitKey, 3600);
    if (requests > 1000) {
      return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded: 1000 requests/hour' } });
    }

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const cacheKey = `apikey:${keyHash.slice(0, 20)}`;
    let keyData: any;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) keyData = JSON.parse(cached);
    } catch {}

    if (!keyData) {
      const result = await pool.query(
        `SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())`,
        [keyHash]
      );
      if (!result.rows[0]) {
        return res.status(401).json({ success: false, error: { code: 'INVALID_KEY', message: 'Invalid or expired API key' } });
      }
      keyData = result.rows[0];
      try { await redis.setex(cacheKey, 60, JSON.stringify(keyData)); } catch {}
    }

    req.user = { id: keyData.created_by || keyData.org_id, orgId: keyData.org_id, role: 'api' };
    (req as any).apiKeyId = keyData.id;
    (req as any).apiKeyPermissions = keyData.permissions || ['read'];

    pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [keyData.id]).catch(() => {});

    const startTime = Date.now();
    res.on('finish', () => {
      pool.query(
        `INSERT INTO api_usage_logs (api_key_id, org_id, method, path, status_code, response_time_ms, ip_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [keyData.id, keyData.org_id, req.method, req.path, res.statusCode, Date.now() - startTime, req.ip || 'unknown']
      ).catch(() => {});
    });

    next();
  } catch (err) {
    return next(err);
  }
}
