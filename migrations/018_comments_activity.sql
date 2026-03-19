-- Migration 018: Extend comments + activity log

-- ─── Extend comments table ────────────────────────────────────────────────────
-- Add org_id for multi-tenancy
ALTER TABLE comments ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Add entity linking (replaces task_id-only model)
ALTER TABLE comments ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50); -- task | design | content
ALTER TABLE comments ADD COLUMN IF NOT EXISTS entity_id UUID;

-- Threading support
ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES comments(id) ON DELETE CASCADE;

-- Soft delete
ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Backfill entity_type for existing task comments
UPDATE comments SET entity_type = 'task', entity_id = task_id WHERE task_id IS NOT NULL AND entity_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

-- ─── Activity log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(255),
  action      VARCHAR(100) NOT NULL, -- task_created | design_uploaded | content_approved | comment_added etc
  entity_type VARCHAR(50),           -- task | design | content | project | file
  entity_id   UUID,
  entity_name VARCHAR(255),
  meta        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_client ON activity_log(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_org    ON activity_log(org_id, created_at DESC);

-- ─── Approvals: add approval columns to design_briefs ─────────────────────────
ALTER TABLE design_briefs
  ADD COLUMN IF NOT EXISTS approved_by    UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_note TEXT;

-- ─── Approvals: add approval columns to content_pieces ────────────────────────
ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS approved_by    UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_note TEXT;

-- ─── AI insights storage ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_insights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  insights    JSONB DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_insights ON client_insights(client_id, generated_at DESC);
