import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthPayload {
  id: string;
  orgId: string;
  role: string;           // 'admin' | 'manager' | 'member' | 'team' | 'client'
  name?: string;
  clientId?: string;      // set only when role === 'client'
  isSuperAdmin?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// ── Core middleware ───────────────────────────────────────────────────────────

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, next);
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * authorize(...roles)
 * Empty list = any authenticated user.
 * authorize('admin')                          → admin only
 * authorize('admin', 'manager')               → admin/manager
 * authorize('admin', 'manager', 'member', 'team') → all staff (no clients)
 */
export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (roles.length && !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient permissions' }); return;
    }
    next();
  };
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/** Admin only */
export const adminOnly = authorize('admin');

/** Admin + manager */
export const adminOrManager = authorize('admin', 'manager');

/** All internal staff — excludes client users */
export const staffOnly = authorize('admin', 'manager', 'member', 'team');

/** True for roles with full internal access */
export function isAdminRole(role: string): boolean {
  return role === 'admin' || role === 'manager';
}

/** True for any staff member (not a client) */
export function isStaffRole(role: string): boolean {
  return role !== 'client';
}
