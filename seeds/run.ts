import bcrypt from 'bcryptjs';
import { pool } from '../src/config/database';

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Organization
    const orgRes = await client.query(
      `INSERT INTO organizations (name, slug, plan)
       VALUES ('Red Octopus Agency', 'red-octopus-agency', 'pro')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const orgId = orgRes.rows[0].id;

    // Admin user
    const hash = await bcrypt.hash('Admin123!', 12);
    const adminRes = await client.query(
      `INSERT INTO users (org_id, name, email, password_hash, role, email_verified)
       VALUES ($1, 'Admin', 'admin@flowos.io', $2, 'admin', true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [orgId, hash]
    );
    const adminId = adminRes.rows[0].id;

    // Team members
    const memberHash = await bcrypt.hash('Member123!', 12);
    const m1 = await client.query(
      `INSERT INTO users (org_id, name, email, password_hash, role, email_verified)
       VALUES ($1, 'Sara Ahmed', 'sara@flowos.io', $2, 'member', true)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [orgId, memberHash]
    );
    const m2 = await client.query(
      `INSERT INTO users (org_id, name, email, password_hash, role, email_verified)
       VALUES ($1, 'Karim Hassan', 'karim@flowos.io', $2, 'member', true)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [orgId, memberHash]
    );

    // Clients
    const c1 = await client.query(
      `INSERT INTO clients (org_id, name, email, company) VALUES ($1,'Nadia Corp','nadia@nadiacorp.com','Nadia Corp') RETURNING id`,
      [orgId]
    );
    const c2 = await client.query(
      `INSERT INTO clients (org_id, name, email, company) VALUES ($1,'Gulf Brands','info@gulfbrands.ae','Gulf Brands') RETURNING id`,
      [orgId]
    );

    // Projects
    const p1 = await client.query(
      `INSERT INTO projects (org_id, client_id, name, description, status, service_type, color, manager_id, progress)
       VALUES ($1,$2,'Social Media Campaign Q2','Full social media management for Q2','active','social_media','#4f8cff',$3,65) RETURNING id`,
      [orgId, c1.rows[0].id, adminId]
    );
    const p2 = await client.query(
      `INSERT INTO projects (org_id, client_id, name, description, status, service_type, color, manager_id, progress)
       VALUES ($1,$2,'Brand Identity Redesign','Complete visual overhaul','active','branding','#7c3aed',$3,30) RETURNING id`,
      [orgId, c2.rows[0].id, adminId]
    );

    // Project members
    await client.query('INSERT INTO project_members VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [p1.rows[0].id, adminId, 'manager']);
    await client.query('INSERT INTO project_members VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [p1.rows[0].id, m1.rows[0].id, 'member']);
    await client.query('INSERT INTO project_members VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [p2.rows[0].id, adminId, 'manager']);
    await client.query('INSERT INTO project_members VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [p2.rows[0].id, m2.rows[0].id, 'member']);

    // Tasks
    const tasks = [
      { title: 'Create Instagram content calendar', status: 'done', priority: 'high', assigneeId: m1.rows[0].id, projectId: p1.rows[0].id },
      { title: 'Design Facebook ad creatives', status: 'in_progress', priority: 'high', assigneeId: m1.rows[0].id, projectId: p1.rows[0].id },
      { title: 'Write LinkedIn articles (x4)', status: 'todo', priority: 'medium', assigneeId: adminId, projectId: p1.rows[0].id },
      { title: 'Set up TikTok account', status: 'todo', priority: 'low', assigneeId: m2.rows[0].id, projectId: p1.rows[0].id },
      { title: 'Monthly analytics report', status: 'review', priority: 'medium', assigneeId: m1.rows[0].id, projectId: p1.rows[0].id },
      { title: 'Logo design concepts (x3)', status: 'done', priority: 'high', assigneeId: m2.rows[0].id, projectId: p2.rows[0].id },
      { title: 'Brand guidelines document', status: 'in_progress', priority: 'high', assigneeId: adminId, projectId: p2.rows[0].id },
      { title: 'Color palette finalization', status: 'todo', priority: 'medium', assigneeId: m2.rows[0].id, projectId: p2.rows[0].id },
      { title: 'Typography selection', status: 'todo', priority: 'medium', assigneeId: adminId, projectId: p2.rows[0].id },
      { title: 'Client presentation deck', status: 'todo', priority: 'high', assigneeId: m1.rows[0].id, projectId: p2.rows[0].id },
    ];

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      await client.query(
        `INSERT INTO tasks (org_id, project_id, title, status, priority, assignee_id, reporter_id, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [orgId, t.projectId, t.title, t.status, t.priority, t.assigneeId, adminId, String(i + 1).padStart(6, '0')]
      );
    }

    await client.query('COMMIT');
    console.log('[Seeds] Done! Admin: admin@flowos.io / Admin123!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Seeds] Failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
