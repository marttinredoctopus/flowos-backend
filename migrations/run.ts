import { pool } from '../src/config/database';
import fs from 'fs';
import path from 'path';

async function runMigrations() {
  const client = await pool.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        ran_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Run the main schema
    const schemaPath = path.join(__dirname, '002_main_schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ('002_main_schema') ON CONFLICT DO NOTHING");
      await client.query('COMMIT');
      console.log('[Migrations] 002_main_schema applied');
    }

    console.log('[Migrations] All done');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migrations] Failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
