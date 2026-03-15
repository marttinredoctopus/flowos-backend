-- Migration 006: New Features (Design Hub, Content Team, Docs, Goals, Forms, Intelligence, Task Assignees)

-- Task multi-assignees
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),
  PRIMARY KEY (task_id, user_id)
);

-- Task subtasks (self-referencing)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE;

-- Task dependencies
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id)
);

-- Design briefs
CREATE TABLE IF NOT EXISTS design_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id),
  client_id UUID REFERENCES clients(id),
  title VARCHAR(255) NOT NULL,
  asset_type VARCHAR(50) DEFAULT 'other',
  status VARCHAR(50) DEFAULT 'brief_received',
  assigned_designer UUID REFERENCES users(id),
  deadline DATE,
  brief_content TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Design assets / file versions
CREATE TABLE IF NOT EXISTS design_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  brief_id UUID REFERENCES design_briefs(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id),
  client_id UUID REFERENCES clients(id),
  name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_type VARCHAR(50),
  version INTEGER DEFAULT 1,
  is_current BOOLEAN DEFAULT TRUE,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand guidelines per client
CREATE TABLE IF NOT EXISTS brand_guidelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  logo_urls JSONB DEFAULT '[]',
  primary_color VARCHAR(7),
  secondary_color VARCHAR(7),
  accent_color VARCHAR(7),
  extra_colors JSONB DEFAULT '[]',
  primary_font VARCHAR(100),
  secondary_font VARCHAR(100),
  tone_of_voice TEXT,
  brand_values TEXT,
  do_list JSONB DEFAULT '[]',
  dont_list JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, client_id)
);

-- Design feedback pins
CREATE TABLE IF NOT EXISTS design_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID REFERENCES design_assets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  x_percent FLOAT NOT NULL,
  y_percent FLOAT NOT NULL,
  comment TEXT NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  pin_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content pieces (content calendar)
CREATE TABLE IF NOT EXISTS content_pieces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id),
  client_id UUID REFERENCES clients(id),
  title VARCHAR(255) NOT NULL,
  platform VARCHAR(50) DEFAULT 'instagram',
  content_type VARCHAR(50) DEFAULT 'post',
  status VARCHAR(50) DEFAULT 'draft',
  assigned_writer UUID REFERENCES users(id),
  assigned_designer UUID REFERENCES users(id),
  publish_at TIMESTAMPTZ,
  caption TEXT,
  media_urls JSONB DEFAULT '[]',
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Caption / copy bank
CREATE TABLE IF NOT EXISTS copy_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  platform VARCHAR(50),
  content_type VARCHAR(50),
  tone VARCHAR(50),
  caption TEXT NOT NULL,
  hashtags TEXT[],
  performance_label VARCHAR(30),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Docs / Wiki (Notion-style)
CREATE TABLE IF NOT EXISTS docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES docs(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Untitled',
  content JSONB,
  icon VARCHAR(20),
  cover_url TEXT,
  created_by UUID REFERENCES users(id),
  position FLOAT DEFAULT 1000,
  is_archived BOOLEAN DEFAULT FALSE,
  is_favorite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Goals & OKRs
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES users(id),
  due_date DATE,
  category VARCHAR(50) DEFAULT 'other',
  status VARCHAR(50) DEFAULT 'on_track',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS key_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  start_value FLOAT DEFAULT 0,
  target_value FLOAT NOT NULL,
  current_value FLOAT DEFAULT 0,
  unit VARCHAR(50),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sprints
CREATE TABLE IF NOT EXISTS sprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  goal TEXT,
  start_date DATE,
  end_date DATE,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sprint_tasks (
  sprint_id UUID REFERENCES sprints(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (sprint_id, task_id)
);

-- Custom fields per project
CREATE TABLE IF NOT EXISTS custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  field_type VARCHAR(50) NOT NULL,
  options JSONB,
  position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_custom_values (
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  field_id UUID REFERENCES custom_fields(id) ON DELETE CASCADE,
  value JSONB,
  PRIMARY KEY (task_id, field_id)
);

-- Forms (Typeform-style)
CREATE TABLE IF NOT EXISTS forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  fields JSONB DEFAULT '[]',
  settings JSONB DEFAULT '{}',
  slug VARCHAR(100) UNIQUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS form_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID REFERENCES forms(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  respondent_email VARCHAR(255),
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Competitor analyses (Anthropic AI)
CREATE TABLE IF NOT EXISTS competitor_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  brand_name VARCHAR(255),
  industry VARCHAR(255),
  competitors JSONB DEFAULT '[]',
  analysis_types JSONB DEFAULT '[]',
  results JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Research conversations
CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  title VARCHAR(255) DEFAULT 'New Conversation',
  messages JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign concepts (AI generated)
CREATE TABLE IF NOT EXISTS campaign_concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  project_id UUID REFERENCES projects(id),
  brand_name VARCHAR(255),
  objective VARCHAR(100),
  target_audience TEXT,
  budget_range VARCHAR(100),
  duration VARCHAR(100),
  platforms JSONB DEFAULT '[]',
  tone VARCHAR(50),
  concepts JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recurring task templates
CREATE TABLE IF NOT EXISTS task_recurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  frequency VARCHAR(20) NOT NULL,
  interval_value INTEGER DEFAULT 1,
  until_date DATE,
  max_occurrences INTEGER,
  current_occurrences INTEGER DEFAULT 0,
  next_due TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_design_briefs_org ON design_briefs(org_id);
CREATE INDEX IF NOT EXISTS idx_content_pieces_org ON content_pieces(org_id, publish_at);
CREATE INDEX IF NOT EXISTS idx_docs_org ON docs(org_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_goals_org ON goals(org_id);
CREATE INDEX IF NOT EXISTS idx_forms_org ON forms(org_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_competitor_analyses_org ON competitor_analyses(org_id);
