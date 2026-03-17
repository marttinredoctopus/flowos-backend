import { pool } from '../config/database';

// Storage limits per plan in bytes
export const PLAN_STORAGE: Record<string, number> = {
  free:   1   * 1024 * 1024 * 1024,  // 1 GB
  pro:    20  * 1024 * 1024 * 1024,  // 20 GB
  agency: 100 * 1024 * 1024 * 1024,  // 100 GB
};

// Max file size per plan
export const PLAN_FILE_SIZE: Record<string, number> = {
  free:   10  * 1024 * 1024,  // 10 MB
  pro:    100 * 1024 * 1024,  // 100 MB
  agency: 500 * 1024 * 1024,  // 500 MB
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024)               return `${bytes} B`;
  if (bytes < 1024 * 1024)        return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function checkQuota(
  orgId: string,
  newFileSize: number
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number; plan: string }> {
  const { rows } = await pool.query(
    `SELECT COALESCE(storage_used_bytes, 0) AS storage_used_bytes, plan
     FROM organizations WHERE id = $1`,
    [orgId]
  );

  const org   = rows[0];
  const plan  = org?.plan || 'free';
  const limit = PLAN_STORAGE[plan] || PLAN_STORAGE.free;
  const used  = Number(org?.storage_used_bytes || 0);

  return {
    allowed:   (used + newFileSize) <= limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    plan,
  };
}

export async function addStorageUsage(orgId: string, bytes: number): Promise<void> {
  await pool.query(
    `UPDATE organizations
     SET storage_used_bytes = COALESCE(storage_used_bytes, 0) + $1
     WHERE id = $2`,
    [bytes, orgId]
  );
}

export async function removeStorageUsage(orgId: string, bytes: number): Promise<void> {
  await pool.query(
    `UPDATE organizations
     SET storage_used_bytes = GREATEST(0, COALESCE(storage_used_bytes, 0) - $1)
     WHERE id = $2`,
    [bytes, orgId]
  );
}
