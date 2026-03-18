-- AI usage tracking for rate limiting and future billing
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id      UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type        VARCHAR(50)   NOT NULL DEFAULT 'general',
  tokens_used INTEGER       NOT NULL DEFAULT 0,
  provider    VARCHAR(20)   NOT NULL DEFAULT 'openai',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_usage_log_org_idx      ON ai_usage_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_log_user_idx     ON ai_usage_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_log_monthly_idx  ON ai_usage_log (org_id, date_trunc('month', created_at));
