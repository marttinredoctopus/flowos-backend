import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { generateCampaignInsights, competitorAnalysis } from '../services/geminiService';

export async function campaignInsights(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const orgId = (req as any).user?.orgId;
    const result = await pool.query(
      'SELECT * FROM ad_campaigns WHERE id=$1 AND org_id=$2',
      [id, orgId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Campaign not found' }); return; }
    const insights = await generateCampaignInsights(result.rows[0]);
    res.json({ insights });
  } catch (err) { next(err); }
}

export async function analyzeCompetitors(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { industry, competitors, platform } = req.body;
    if (!industry || !competitors?.length) {
      res.status(400).json({ error: 'industry and competitors are required' });
      return;
    }
    const analysis = await competitorAnalysis(industry, competitors, platform || 'Meta');
    res.json({ analysis });
  } catch (err) { next(err); }
}

export async function saveAdAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = (req as any).user?.orgId;
    const { platform, accountId, accessToken } = req.body;
    if (!platform || !accountId) { res.status(400).json({ error: 'platform and accountId required' }); return; }
    await pool.query(
      `INSERT INTO ad_accounts (org_id, platform, account_id, access_token)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (org_id, platform) DO UPDATE SET account_id=$3, access_token=$4, updated_at=NOW()`,
      [orgId, platform, accountId, accessToken || null]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function listAdAccounts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = (req as any).user?.orgId;
    const result = await pool.query(
      'SELECT id, platform, account_id, created_at FROM ad_accounts WHERE org_id=$1 ORDER BY platform',
      [orgId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}
