-- ─── Automation Rules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  description      TEXT,
  trigger_event    VARCHAR(100) NOT NULL,
  trigger_filters  JSONB NOT NULL DEFAULT '{}',
  action_type      VARCHAR(100) NOT NULL,
  action_config    JSONB NOT NULL DEFAULT '{}',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  run_count        INTEGER NOT NULL DEFAULT 0,
  last_run_at      TIMESTAMPTZ,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS automations_org_idx      ON automations (org_id);
CREATE INDEX IF NOT EXISTS automations_event_idx    ON automations (trigger_event) WHERE is_active = TRUE;

-- Automation execution log
CREATE TABLE IF NOT EXISTS automation_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id  UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status         VARCHAR(20) NOT NULL DEFAULT 'success', -- success | failed | skipped
  trigger_data   JSONB,
  result         JSONB,
  error          TEXT,
  ran_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS automation_logs_auto_idx ON automation_logs (automation_id, ran_at DESC);

-- ─── Project Templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  category     VARCHAR(100) DEFAULT 'General',
  color        VARCHAR(7)   DEFAULT '#7c6fe0',
  icon         VARCHAR(10)  DEFAULT '📋',
  is_public    BOOLEAN NOT NULL DEFAULT FALSE,
  use_count    INTEGER NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_templates_org_idx ON project_templates (org_id);

-- Template tasks
CREATE TABLE IF NOT EXISTS template_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      UUID NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
  title            VARCHAR(255) NOT NULL,
  description      TEXT,
  priority         VARCHAR(20)  NOT NULL DEFAULT 'medium',
  estimated_hours  NUMERIC(6,2),
  position         INTEGER      NOT NULL DEFAULT 0,
  offset_days      INTEGER      NOT NULL DEFAULT 0,
  tags             TEXT[]
);

CREATE INDEX IF NOT EXISTS template_tasks_template_idx ON template_tasks (template_id, position);

-- ─── Client Portal Tokens ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_portal_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token      VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_portal_client_idx ON client_portal_tokens (client_id);
