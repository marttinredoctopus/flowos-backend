-- Migration 010: Cloudflare R2 Storage

-- Add storage tracking columns to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT DEFAULT 1073741824;

-- Org files registry (tracks all R2 uploads)
CREATE TABLE IF NOT EXISTS org_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  r2_key       TEXT NOT NULL UNIQUE,
  public_url   TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime_type    VARCHAR(100),
  size_bytes   BIGINT NOT NULL DEFAULT 0,
  folder       VARCHAR(50) DEFAULT 'files',
  entity_type  VARCHAR(50),
  entity_id    UUID,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_files_org    ON org_files(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_files_entity ON org_files(entity_type, entity_id);
