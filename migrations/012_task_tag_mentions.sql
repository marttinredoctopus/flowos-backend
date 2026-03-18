-- Migration 012: task tag + comment mentions

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS tag VARCHAR(50);

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS mentions JSONB DEFAULT '[]';
