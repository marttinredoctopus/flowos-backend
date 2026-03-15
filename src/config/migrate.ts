import { pool } from './database';
import fs from 'fs';
import path from 'path';

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        ran_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const { rows: ran } = await client.query('SELECT name FROM _migrations');
    const ranSet = new Set(ran.map((r: any) => r.name));

    // Look for SQL files - in production they're in the project root migrations/
    const candidates = [
      path.join(process.cwd(), 'migrations'),
      path.join(__dirname, '..', '..', 'migrations'),
    ];
    const migrationsDir = candidates.find(d => fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.sql')));

    if (!migrationsDir) {
      console.log('[Migrations] No migrations directory found, skipping');
      return;
    }

    const sqlFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of sqlFiles) {
      const name = file.replace('.sql', '');
      if (ranSet.has(name)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log(`[Migrations] Applied: ${name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[Migrations] Failed: ${name}`, err);
        throw err;
      }
    }

    console.log('[Migrations] Done');
  } finally {
    client.release();
  }
}
