import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticate } from '../middleware/auth';
import { MetaAdsService } from '../services/metaAdsService';
import { OpenRouterService } from '../services/openRouterService';
import { query, queryOne } from '../config/database';
import { setEx, get as redisGet } from '../config/redis';
import { env } from '../config/env';

const router = Router();

// ─── OAuth: Start ────────────────────────────────────────────────────────────
router.get('/connect', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    await setEx(`meta_oauth_${state}`, 600, req.user!.orgId);
    const url = MetaAdsService.getOAuthUrl(state);
    res.json({ success: true, data: { url } });
  } catch (err) { next(err); }
});

// ─── OAuth: Callback ─────────────────────────────────────────────────────────
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;
  const frontendUrl = env.FRONTEND_URL;

  if (error || !code || !state) {
    res.redirect(`${frontendUrl}/dashboard/campaigns?meta_error=cancelled`); return;
  }

  try {
    const orgId = await redisGet(`meta_oauth_${state}`);
    if (!orgId) { res.redirect(`${frontendUrl}/dashboard/campaigns?meta_error=expired`); return; }

    const accessToken = await MetaAdsService.exchangeCode(code);
    const userInfo = await MetaAdsService.getMetaUser(accessToken);
    const accounts = await MetaAdsService.getAdAccounts(accessToken);

    for (const account of accounts.slice(0, 10)) {
      const accountId = account.id.replace('act_', '');
      await query(`
        INSERT INTO meta_ad_accounts (org_id, meta_user_id, meta_account_id, account_name, access_token, currency, timezone, connected_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT id FROM users WHERE org_id=$1 AND role='admin' LIMIT 1))
        ON CONFLICT DO NOTHING
      `, [orgId, userInfo.id, accountId, account.name, accessToken, account.currency, account.timezone_name]);
    }

    MetaAdsService.syncOrgAccounts(orgId).catch(console.error);
    res.redirect(`${frontendUrl}/dashboard/campaigns?meta_connected=true`);
  } catch (err: any) {
    console.error('[MetaAds] OAuth callback error:', err.message);
    res.redirect(`${frontendUrl}/dashboard/campaigns?meta_error=failed`);
  }
});

// ─── Connect via Manual Token ─────────────────────────────────────────────────
router.post('/connect-token', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { access_token } = req.body;
    if (!access_token) { res.status(400).json({ error: 'access_token is required' }); return; }

    const userInfo = await MetaAdsService.getMetaUser(access_token);
    const accounts = await MetaAdsService.getAdAccounts(access_token);

    if (!accounts.length) { res.status(400).json({ error: 'No ad accounts found for this token' }); return; }

    for (const account of accounts.slice(0, 10)) {
      const accountId = account.id.replace('act_', '');
      await query(`
        INSERT INTO meta_ad_accounts (org_id, meta_user_id, meta_account_id, account_name, access_token, currency, timezone, connected_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
      `, [req.user!.orgId, userInfo.id, accountId, account.name, access_token, account.currency, account.timezone_name, req.user!.id]);
    }

    MetaAdsService.syncOrgAccounts(req.user!.orgId).catch(console.error);
    res.json({ success: true, data: { accounts_connected: accounts.length } });
  } catch (err: any) {
    if (err.message?.includes('Meta API error')) {
      res.status(400).json({ error: 'Invalid or expired access token' }); return;
    }
    next(err);
  }
});

// ─── Get Connected Accounts ───────────────────────────────────────────────────
router.get('/accounts', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = await query<any>(
      `SELECT id, meta_account_id, account_name, currency, timezone, is_active, updated_at
       FROM meta_ad_accounts WHERE org_id = $1 AND is_active = TRUE ORDER BY created_at DESC`,
      [req.user!.orgId]
    );
    res.json({ success: true, data: { accounts } });
  } catch (err) { next(err); }
});

// ─── Get Campaigns + Stats ────────────────────────────────────────────────────
router.get('/campaigns', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { account_id, date_start, date_end, status } = req.query as Record<string, string>;
    const start = date_start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = date_end || new Date().toISOString().split('T')[0];

    const params: any[] = [start, end, req.user!.orgId];
    let extra = '';
    if (account_id) { extra += ` AND c.account_id = $${params.length + 1}`; params.push(account_id); }
    if (status)     { extra += ` AND c.status = $${params.length + 1}`;     params.push(status); }

    const campaigns = await query<any>(`
      SELECT
        c.id, c.meta_campaign_id, c.name, c.status, c.objective,
        c.daily_budget, c.lifetime_budget, c.start_time, c.end_time,
        COALESCE(SUM(s.impressions), 0)::BIGINT AS impressions,
        COALESCE(SUM(s.clicks), 0)::BIGINT      AS clicks,
        COALESCE(SUM(s.spend), 0)               AS spend,
        COALESCE(SUM(s.reach), 0)::BIGINT       AS reach,
        COALESCE(SUM(s.conversions), 0)         AS conversions,
        COALESCE(SUM(s.conversion_value), 0)    AS revenue,
        CASE WHEN SUM(s.clicks)      > 0 THEN SUM(s.spend) / SUM(s.clicks) ELSE 0 END AS cpc,
        CASE WHEN SUM(s.impressions) > 0 THEN SUM(s.spend) / SUM(s.impressions) * 1000 ELSE 0 END AS cpm,
        CASE WHEN SUM(s.impressions) > 0 THEN SUM(s.clicks)::FLOAT / SUM(s.impressions) * 100 ELSE 0 END AS ctr,
        CASE WHEN SUM(s.spend)       > 0 THEN SUM(s.conversion_value) / SUM(s.spend) ELSE 0 END AS roas
      FROM meta_campaigns c
      LEFT JOIN meta_campaign_stats s ON s.campaign_id = c.id AND s.date BETWEEN $1 AND $2
      WHERE c.org_id = $3 ${extra}
      GROUP BY c.id
      ORDER BY SUM(s.spend) DESC NULLS LAST
    `, params);

    const summary = campaigns.reduce((acc: any, c: any) => ({
      total_spend:       acc.total_spend       + Number(c.spend),
      total_impressions: acc.total_impressions + Number(c.impressions),
      total_clicks:      acc.total_clicks      + Number(c.clicks),
      total_conversions: acc.total_conversions + Number(c.conversions),
      total_revenue:     acc.total_revenue     + Number(c.revenue),
    }), { total_spend: 0, total_impressions: 0, total_clicks: 0, total_conversions: 0, total_revenue: 0 });

    summary.avg_roas = summary.total_spend > 0 ? summary.total_revenue / summary.total_spend : 0;
    summary.avg_ctr  = summary.total_impressions > 0 ? summary.total_clicks / summary.total_impressions * 100 : 0;
    summary.avg_cpc  = summary.total_clicks > 0 ? summary.total_spend / summary.total_clicks : 0;

    res.json({ success: true, data: { campaigns, summary, date_range: { start, end } } });
  } catch (err) { next(err); }
});

// ─── Daily Chart Data ─────────────────────────────────────────────────────────
router.get('/chart', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date_start, date_end, account_id } = req.query as Record<string, string>;
    const start = date_start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end   = date_end   || new Date().toISOString().split('T')[0];

    const params: any[] = [req.user!.orgId, start, end];
    let join = '';
    let extra = '';
    if (account_id) {
      join  = `JOIN meta_campaigns c2 ON c2.id = s.campaign_id`;
      extra = `AND c2.account_id = $${params.length + 1}`;
      params.push(account_id);
    }

    const chart = await query<any>(`
      SELECT
        s.date,
        SUM(s.spend)            AS spend,
        SUM(s.impressions)      AS impressions,
        SUM(s.clicks)           AS clicks,
        SUM(s.conversions)      AS conversions,
        SUM(s.conversion_value) AS revenue,
        CASE WHEN SUM(s.spend) > 0 THEN SUM(s.conversion_value) / SUM(s.spend) ELSE 0 END AS roas
      FROM meta_campaign_stats s
      ${join}
      WHERE s.org_id = $1 AND s.date BETWEEN $2 AND $3 ${extra}
      GROUP BY s.date ORDER BY s.date ASC
    `, params);

    res.json({ success: true, data: { chart } });
  } catch (err) { next(err); }
});

// ─── Manual Sync ──────────────────────────────────────────────────────────────
router.post('/sync', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    MetaAdsService.syncOrgAccounts(req.user!.orgId).catch(console.error);
    res.json({ success: true, message: 'Sync started in background' });
  } catch (err) { next(err); }
});

// ─── Create Share Link ────────────────────────────────────────────────────────
router.post('/share', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, account_ids, campaign_ids, client_id, date_range, custom_start, custom_end, password, expires_days } = req.body;

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = expires_days ? new Date(Date.now() + Number(expires_days) * 24 * 60 * 60 * 1000) : null;
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    await query(`
      INSERT INTO campaign_report_shares
        (org_id, created_by, token, title, account_ids, campaign_ids, client_id, date_range, custom_start, custom_end, password, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [
      req.user!.orgId, req.user!.id, token, title || 'Campaign Report',
      account_ids || null, campaign_ids || null, client_id || null,
      date_range || 'last_30_days', custom_start || null, custom_end || null,
      hashedPassword, expiresAt,
    ]);

    const shareUrl = `${env.FRONTEND_URL}/reports/${token}`;
    res.json({ success: true, data: { token, url: shareUrl } });
  } catch (err) { next(err); }
});

// ─── List Share Links ─────────────────────────────────────────────────────────
router.get('/shares', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shares = await query<any>(
      `SELECT s.id, s.token, s.title, s.date_range, s.is_active, s.views, s.expires_at, s.created_at,
              cl.name AS client_name
       FROM campaign_report_shares s
       LEFT JOIN clients cl ON cl.id = s.client_id
       WHERE s.org_id = $1 ORDER BY s.created_at DESC`,
      [req.user!.orgId]
    );
    res.json({ success: true, data: { shares } });
  } catch (err) { next(err); }
});

// ─── Delete / Deactivate Share ────────────────────────────────────────────────
router.delete('/shares/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await query(
      `UPDATE campaign_report_shares SET is_active=FALSE WHERE id=$1 AND org_id=$2`,
      [req.params.id, req.user!.orgId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── AI Campaign Analysis ─────────────────────────────────────────────────────
router.post('/campaigns/:id/analyze', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { date_start, date_end } = req.body as Record<string, string>;
    const start = date_start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end   = date_end   || new Date().toISOString().split('T')[0];

    const row = await queryOne<any>(`
      SELECT
        c.id, c.name, c.status, c.objective,
        COALESCE(SUM(s.spend), 0)            AS spend,
        COALESCE(SUM(s.conversion_value), 0) AS revenue,
        COALESCE(SUM(s.impressions), 0)      AS impressions,
        COALESCE(SUM(s.clicks), 0)           AS clicks,
        COALESCE(SUM(s.conversions), 0)      AS conversions,
        CASE WHEN SUM(s.clicks) > 0      THEN SUM(s.spend) / SUM(s.clicks)                    ELSE 0 END AS cpc,
        CASE WHEN SUM(s.impressions) > 0 THEN SUM(s.spend) / SUM(s.impressions) * 1000        ELSE 0 END AS cpm,
        CASE WHEN SUM(s.impressions) > 0 THEN SUM(s.clicks)::FLOAT / SUM(s.impressions) * 100 ELSE 0 END AS ctr,
        CASE WHEN SUM(s.spend) > 0       THEN SUM(s.conversion_value) / SUM(s.spend)          ELSE 0 END AS roas,
        CASE WHEN SUM(s.reach) > 0       THEN SUM(s.impressions)::FLOAT / SUM(s.reach)        ELSE 1 END AS frequency
      FROM meta_campaigns c
      LEFT JOIN meta_campaign_stats s ON s.campaign_id = c.id AND s.date BETWEEN $2 AND $3
      WHERE c.id = $1 AND c.org_id = $4
      GROUP BY c.id, c.name, c.status, c.objective
    `, [id, start, end, req.user!.orgId]);

    if (!row) { res.status(404).json({ error: 'Campaign not found' }); return; }

    const report = await OpenRouterService.analyzeCampaign({
      name:        row.name,
      status:      row.status,
      objective:   row.objective,
      date_start:  start,
      date_end:    end,
      spend:       Number(row.spend),
      revenue:     Number(row.revenue),
      roas:        Number(row.roas),
      impressions: Number(row.impressions),
      clicks:      Number(row.clicks),
      ctr:         Number(row.ctr),
      cpc:         Number(row.cpc),
      cpm:         Number(row.cpm),
      conversions: Number(row.conversions),
      frequency:   Number(row.frequency),
    });

    // Save report (best-effort — table may not exist yet)
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS campaign_ai_reports (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          campaign_id UUID NOT NULL,
          org_id UUID NOT NULL,
          date_start DATE NOT NULL,
          date_end DATE NOT NULL,
          report JSONB NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (campaign_id, date_start, date_end)
        )
      `);
      await query(`
        INSERT INTO campaign_ai_reports (campaign_id, org_id, date_start, date_end, report)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (campaign_id, date_start, date_end) DO UPDATE SET report = $5, updated_at = NOW()
      `, [id, req.user!.orgId, start, end, JSON.stringify(report)]);
    } catch (e) { /* non-fatal */ }

    res.json({ success: true, data: { report, campaign: { id: row.id, name: row.name, status: row.status } } });
  } catch (err) { next(err); }
});

// ─── Public Report (no auth) ──────────────────────────────────────────────────
router.get('/public/:token', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token } = req.params;
    const { password } = req.query as Record<string, string>;

    const share = await queryOne<any>(
      `SELECT * FROM campaign_report_shares WHERE token = $1 AND is_active = TRUE`,
      [token]
    );
    if (!share) { res.status(404).json({ error: 'Report not found' }); return; }

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      res.status(410).json({ error: 'Report link has expired' }); return;
    }

    if (share.password) {
      if (!password) { res.status(401).json({ error: 'Password required', password_required: true }); return; }
      const valid = await bcrypt.compare(password, share.password);
      if (!valid) { res.status(401).json({ error: 'Incorrect password' }); return; }
    }

    await query(`UPDATE campaign_report_shares SET views = views + 1 WHERE token = $1`, [token]);

    // Compute date range
    let start: string;
    let end: string = share.custom_end || new Date().toISOString().split('T')[0];

    if (share.date_range === 'last_7_days') {
      start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else if (share.date_range === 'last_30_days') {
      start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else if (share.date_range === 'last_90_days') {
      start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else {
      start = share.custom_start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    const campaigns = await query<any>(`
      SELECT c.name, c.status, c.objective,
        COALESCE(SUM(s.impressions),0)      AS impressions,
        COALESCE(SUM(s.clicks),0)           AS clicks,
        COALESCE(SUM(s.spend),0)            AS spend,
        COALESCE(SUM(s.reach),0)            AS reach,
        COALESCE(SUM(s.conversions),0)      AS conversions,
        COALESCE(SUM(s.conversion_value),0) AS revenue,
        CASE WHEN SUM(s.clicks)>0      THEN SUM(s.spend)/SUM(s.clicks) ELSE 0 END AS cpc,
        CASE WHEN SUM(s.impressions)>0 THEN SUM(s.clicks)::FLOAT/SUM(s.impressions)*100 ELSE 0 END AS ctr,
        CASE WHEN SUM(s.spend)>0       THEN SUM(s.conversion_value)/SUM(s.spend) ELSE 0 END AS roas
      FROM meta_campaigns c
      LEFT JOIN meta_campaign_stats s ON s.campaign_id=c.id AND s.date BETWEEN $1 AND $2
      WHERE c.org_id = $3
      GROUP BY c.id ORDER BY SUM(s.spend) DESC NULLS LAST
    `, [start, end, share.org_id]);

    const chart = await query<any>(`
      SELECT date,
        SUM(spend)            AS spend,
        SUM(impressions)      AS impressions,
        SUM(clicks)           AS clicks,
        SUM(conversions)      AS conversions,
        SUM(conversion_value) AS revenue,
        CASE WHEN SUM(spend)>0 THEN SUM(conversion_value)/SUM(spend) ELSE 0 END AS roas
      FROM meta_campaign_stats
      WHERE org_id=$1 AND date BETWEEN $2 AND $3
      GROUP BY date ORDER BY date ASC
    `, [share.org_id, start, end]);

    res.json({
      success: true,
      data: {
        report: { title: share.title, date_range: { start, end } },
        campaigns,
        chart,
      },
    });
  } catch (err) { next(err); }
});

export default router;
