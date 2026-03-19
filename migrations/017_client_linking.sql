-- Migration 017: Client Linking — tie tasks to clients, add share tokens, client files view

-- Add client_id to tasks (direct client assignment, independent of project)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_id);

-- Add share token to clients (for secure client portal access)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS share_token UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS share_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_share_token ON clients(share_token);

-- Backfill share tokens for existing clients that don't have one
UPDATE clients SET share_token = gen_random_uuid() WHERE share_token IS NULL;

-- Content sections: Strategy / Action Plan / Shooting Plan / Content Calendar
CREATE TABLE IF NOT EXISTS content_sections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  section     VARCHAR(50) NOT NULL, -- strategy | action_plan | shooting_plan | calendar
  title       VARCHAR(255) NOT NULL,
  body        TEXT,
  status      VARCHAR(50) DEFAULT 'draft',
  position    INTEGER DEFAULT 0,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_sections_client ON content_sections(client_id, section);
