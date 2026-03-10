import { pool } from '../src/config/database';

async function up(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS content_posts (
        id            UUID PRIMARY KEY,
        workspace_id  UUID NOT NULL,
        created_by    UUID NOT NULL,
        title         VARCHAR(255) NOT NULL,
        body          TEXT,
        platform      VARCHAR(50) NOT NULL
                        CHECK (platform IN ('instagram','twitter','facebook','linkedin','tiktok','youtube')),
        post_type     VARCHAR(50) NOT NULL
                        CHECK (post_type IN ('post','story','reel','video','thread')),
        status        VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','published')),
        scheduled_at  TIMESTAMPTZ,
        published_at  TIMESTAMPTZ,
        media_urls    JSONB NOT NULL DEFAULT '[]',
        tags          JSONB NOT NULL DEFAULT '[]',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_posts_workspace
        ON content_posts (workspace_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_posts_scheduled
        ON content_posts (workspace_id, scheduled_at);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_content_posts_status
        ON content_posts (workspace_id, status);
    `);

    await client.query('COMMIT');
    console.log('Migration 001 applied successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function down(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('DROP TABLE IF EXISTS content_posts CASCADE');
    console.log('Migration 001 rolled back');
  } finally {
    client.release();
  }
}

const arg = process.argv[2];
if (arg === 'down') {
  down().then(() => process.exit(0)).catch(console.error);
} else {
  up().then(() => process.exit(0)).catch(console.error);
}
