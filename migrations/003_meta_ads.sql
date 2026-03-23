-- Meta ad accounts connected by orgs
CREATE TABLE IF NOT EXISTS meta_ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  meta_user_id VARCHAR(255) NOT NULL,
  meta_account_id VARCHAR(255) NOT NULL,
  account_name VARCHAR(255),
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  currency VARCHAR(10) DEFAULT 'USD',
  timezone VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  connected_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaigns synced from Meta
CREATE TABLE IF NOT EXISTS meta_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES meta_ad_accounts(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  meta_campaign_id VARCHAR(255) NOT NULL,
  name VARCHAR(500) NOT NULL,
  status VARCHAR(50),
  objective VARCHAR(100),
  daily_budget DECIMAL(15,2),
  lifetime_budget DECIMAL(15,2),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meta_campaign_id)
);

-- Daily stats per campaign
CREATE TABLE IF NOT EXISTS meta_campaign_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES meta_campaigns(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  spend DECIMAL(15,2) DEFAULT 0,
  reach BIGINT DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  conversion_value DECIMAL(15,2) DEFAULT 0,
  cpc DECIMAL(10,4) DEFAULT 0,
  cpm DECIMAL(10,4) DEFAULT 0,
  ctr DECIMAL(8,4) DEFAULT 0,
  roas DECIMAL(10,4) DEFAULT 0,
  frequency DECIMAL(8,4) DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, date)
);

-- Shareable report links
CREATE TABLE IF NOT EXISTS campaign_report_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  token VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(255) DEFAULT 'Campaign Report',
  account_ids UUID[],
  campaign_ids UUID[],
  client_id UUID REFERENCES clients(id),
  date_range VARCHAR(50) DEFAULT 'last_30_days',
  custom_start DATE,
  custom_end DATE,
  is_active BOOLEAN DEFAULT TRUE,
  password VARCHAR(255),
  views INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_stats_campaign_date ON meta_campaign_stats(campaign_id, date);
CREATE INDEX IF NOT EXISTS idx_meta_stats_org ON meta_campaign_stats(org_id, date);
CREATE INDEX IF NOT EXISTS idx_report_shares_token ON campaign_report_shares(token);
