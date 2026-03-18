-- ─── Client Enhancements ──────────────────────────────────────────────────────
-- Add website, brief, and accounts (stored as JSONB array) to clients

ALTER TABLE clients ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brief TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS accounts JSONB DEFAULT '[]'::jsonb;
