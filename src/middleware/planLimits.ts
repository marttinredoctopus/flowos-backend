import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { getPlan } from '../config/plans';

type Resource = 'projects' | 'team_members' | 'clients';

async function countOrgResource(orgId: string, resource: Resource): Promise<number> {
  const table = resource === 'team_members' ? 'users' : resource;
  const result = await pool.query(
    `SELECT COUNT(*) FROM ${table} WHERE org_id = $1`,
    [orgId]
  );
  return parseInt(result.rows[0].count, 10);
}

export function checkPlanLimit(resource: Resource) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgRes = await pool.query(
        'SELECT plan FROM organizations WHERE id = $1',
        [req.user!.orgId]
      );
      const plan = getPlan(orgRes.rows[0]?.plan || 'starter');
      const limit = plan.limits[resource];

      if (limit === -1) { next(); return; } // unlimited

      const count = await countOrgResource(req.user!.orgId, resource);
      if (count >= limit) {
        res.status(403).json({
          success: false,
          error: {
            code: 'PLAN_LIMIT_REACHED',
            message: `You've reached the ${resource.replace('_', ' ')} limit for your ${plan.name} plan. Upgrade to add more.`,
            limit,
            current: count,
            resource,
            upgrade_url: `${process.env.FRONTEND_URL}/settings/billing`,
          },
        });
        return;
      }
      next();
    } catch (err) { next(err); }
  };
}
