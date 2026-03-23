import { env } from '../config/env';
import { query, queryOne } from '../config/database';

const META_API_BASE = 'https://graph.facebook.com/v19.0';

async function metaFetch(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${META_API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const json = await res.json() as any;
  if (json.error) throw new Error(`Meta API error: ${json.error.message}`);
  return json;
}

export class MetaAdsService {

  static getOAuthUrl(state: string): string {
    const appId = process.env.META_APP_ID || '';
    const backendUrl = process.env.BACKEND_URL || env.FRONTEND_URL.replace('3000', '3001');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: `${backendUrl}/api/meta-ads/callback`,
      scope: 'ads_read,ads_management,read_insights,business_management',
      response_type: 'code',
      state,
    });
    return `https://www.facebook.com/v19.0/dialog/oauth?${params}`;
  }

  static async exchangeCode(code: string): Promise<string> {
    const appId = process.env.META_APP_ID || '';
    const appSecret = process.env.META_APP_SECRET || '';
    const backendUrl = process.env.BACKEND_URL || env.FRONTEND_URL.replace('3000', '3001');
    const data = await metaFetch('/oauth/access_token', {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: `${backendUrl}/api/meta-ads/callback`,
      code,
    });
    // Exchange for long-lived token immediately
    const longData = await metaFetch('/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: data.access_token,
    });
    return longData.access_token || data.access_token;
  }

  static async getMetaUser(accessToken: string): Promise<{ id: string; name: string }> {
    return metaFetch('/me', { access_token: accessToken, fields: 'id,name' });
  }

  static async getAdAccounts(accessToken: string): Promise<any[]> {
    const data = await metaFetch('/me/adaccounts', {
      access_token: accessToken,
      fields: 'id,name,currency,timezone_name,account_status',
      limit: '50',
    });
    return data.data || [];
  }

  static async getCampaigns(accountId: string, accessToken: string): Promise<any[]> {
    const data = await metaFetch(`/act_${accountId}/campaigns`, {
      access_token: accessToken,
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
      limit: '100',
    });
    return data.data || [];
  }

  static async getAccountInsights(
    accountId: string,
    accessToken: string,
    dateStart: string,
    dateEnd: string
  ): Promise<any[]> {
    const data = await metaFetch(`/act_${accountId}/insights`, {
      access_token: accessToken,
      fields: 'campaign_id,campaign_name,impressions,clicks,spend,reach,frequency,cpc,cpm,ctr,actions,action_values',
      time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
      time_increment: '1',
      level: 'campaign',
      limit: '500',
    });
    return data.data || [];
  }

  static async syncAccount(
    accountId: string,
    accessToken: string,
    orgId: string,
    dbAccountId: string
  ): Promise<void> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Sync campaigns
    const campaigns = await this.getCampaigns(accountId, accessToken);
    for (const campaign of campaigns) {
      await query(`
        INSERT INTO meta_campaigns (account_id, org_id, meta_campaign_id, name, status, objective, daily_budget, lifetime_budget, start_time, end_time)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (meta_campaign_id) DO UPDATE SET
          name = EXCLUDED.name, status = EXCLUDED.status,
          daily_budget = EXCLUDED.daily_budget, updated_at = NOW()
      `, [
        dbAccountId, orgId, campaign.id, campaign.name, campaign.status,
        campaign.objective,
        campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
        campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
        campaign.start_time || null, campaign.stop_time || null,
      ]);
    }

    // Sync insights
    const insights = await this.getAccountInsights(accountId, accessToken, startDate, endDate);
    for (const insight of insights) {
      const campaignRow = await queryOne<{ id: string }>(
        `SELECT id FROM meta_campaigns WHERE meta_campaign_id = $1`,
        [insight.campaign_id]
      );
      if (!campaignRow) continue;

      const actions: any[] = insight.actions || [];
      const actionValues: any[] = insight.action_values || [];
      const conversions = Number(actions.find((a: any) => a.action_type === 'purchase')?.value || 0);
      const conversionValue = Number(actionValues.find((a: any) => a.action_type === 'purchase')?.value || 0);
      const spend = parseFloat(insight.spend || '0');
      const roas = spend > 0 && conversionValue > 0 ? conversionValue / spend : 0;

      await query(`
        INSERT INTO meta_campaign_stats
          (campaign_id, org_id, date, impressions, clicks, spend, reach, conversions, conversion_value, cpc, cpm, ctr, roas, frequency)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (campaign_id, date) DO UPDATE SET
          impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, spend=EXCLUDED.spend,
          reach=EXCLUDED.reach, conversions=EXCLUDED.conversions, conversion_value=EXCLUDED.conversion_value,
          cpc=EXCLUDED.cpc, cpm=EXCLUDED.cpm, ctr=EXCLUDED.ctr, roas=EXCLUDED.roas,
          frequency=EXCLUDED.frequency, synced_at=NOW()
      `, [
        campaignRow.id, orgId, insight.date_start,
        insight.impressions || 0, insight.clicks || 0, spend,
        insight.reach || 0, conversions, conversionValue,
        insight.cpc || 0, insight.cpm || 0, insight.ctr || 0,
        roas, insight.frequency || 0,
      ]);
    }
  }

  static async syncOrgAccounts(orgId: string): Promise<void> {
    const accounts = await query<any>(
      `SELECT * FROM meta_ad_accounts WHERE org_id=$1 AND is_active=TRUE`,
      [orgId]
    );
    for (const account of accounts) {
      try {
        await this.syncAccount(account.meta_account_id, account.access_token, orgId, account.id);
        await query(`UPDATE meta_ad_accounts SET updated_at=NOW() WHERE id=$1`, [account.id]);
        console.log(`[MetaAds] Synced account ${account.meta_account_id} for org ${orgId}`);
      } catch (err: any) {
        console.error(`[MetaAds] Sync failed for account ${account.meta_account_id}:`, err.message);
      }
    }
  }
}
