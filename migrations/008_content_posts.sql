-- Migration 008: Content Posts table (for content calendar)

CREATE TABLE IF NOT EXISTS content_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  body TEXT,
  platform VARCHAR(50) NOT NULL DEFAULT 'instagram',
  post_type VARCHAR(50) NOT NULL DEFAULT 'post',
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  media_urls JSONB DEFAULT '[]',
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_posts_workspace ON content_posts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_posts_scheduled ON content_posts(workspace_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_content_posts_status ON content_posts(workspace_id, status);
