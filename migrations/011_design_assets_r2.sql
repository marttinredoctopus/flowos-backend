-- Migration 011: Add R2 fields to design_assets

ALTER TABLE design_assets
  ADD COLUMN IF NOT EXISTS r2_key     TEXT,
  ADD COLUMN IF NOT EXISTS mime_type  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT DEFAULT 0;
