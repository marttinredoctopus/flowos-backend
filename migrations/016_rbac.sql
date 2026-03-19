-- ─── RBAC: client_id on users ─────────────────────────────────────────────────
-- Links a user with role='client' to the clients table record they represent.
-- Admin and team users have NULL client_id.

ALTER TABLE users ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id) WHERE client_id IS NOT NULL;

-- Enforce role values
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'member', 'team', 'client'));
