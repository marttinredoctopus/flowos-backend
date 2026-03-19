import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import OpenAI from 'openai';
import { env } from '../config/env';

/**
 * GET /api/clients/:id/report?period=week|month
 * Generates a performance report for the client
 */
export async function getReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const period = (req.query.period as string) || 'week';
    const orgId = req.user!.orgId;

    // Verify client belongs to org
    const clientRes = await pool.query(
      'SELECT id, name, company FROM clients WHERE id = $1 AND org_id = $2',
      [id, orgId]
    );
    if (!clientRes.rows[0]) throw new AppError('Client not found', 404);
    const client = clientRes.rows[0];

    const interval = period === 'month' ? '30 days' : '7 days';

    const [projects, tasks, designs, content, activity] = await Promise.all([
      // Projects summary
      pool.query(
        `SELECT id, name, status, progress, start_date, end_date
         FROM projects WHERE client_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      // Tasks stats
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE t.status = 'done' AND t.updated_at >= NOW() - INTERVAL '${interval}') as done_this_period,
           COUNT(*) FILTER (WHERE t.status != 'done') as pending,
           COUNT(*) as total
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE p.client_id = $1 OR t.client_id = $1`,
        [id]
      ),
      // Design stats
      pool.query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'client_approved') as approved,
           COUNT(*) FILTER (WHERE status = 'revision_required') as revisions,
           COUNT(*) FILTER (WHERE status = 'review') as pending_review
         FROM design_briefs WHERE client_id = $1 AND org_id = $2`,
        [id, orgId]
      ),
      // Content stats
      pool.query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'published') as published,
           COUNT(*) FILTER (WHERE status = 'approved') as approved,
           COUNT(*) FILTER (WHERE status = 'draft') as drafts,
           COUNT(*) FILTER (WHERE publish_at >= NOW() AND status NOT IN ('published')) as scheduled
         FROM content_pieces WHERE client_id = $1 AND org_id = $2`,
        [id, orgId]
      ),
      // Recent activity
      pool.query(
        `SELECT action, entity_name, actor_name, entity_type, created_at
         FROM activity_log WHERE client_id = $1
         ORDER BY created_at DESC LIMIT 10`,
        [id]
      ),
    ]);

    const projectList = projects.rows;
    const taskStats  = tasks.rows[0];
    const designStats = designs.rows[0];
    const contentStats = content.rows[0];

    const overallProgress = projectList.length
      ? Math.round(projectList.reduce((s, p) => s + (p.progress || 0), 0) / projectList.length)
      : 0;

    const activeProjects = projectList.filter(p => p.status === 'active').length;

    // Build summary data
    const reportData = {
      client,
      period,
      generatedAt: new Date().toISOString(),
      overview: { overallProgress, activeProjects, totalProjects: projectList.length },
      tasks: {
        total: parseInt(taskStats.total),
        completedThisPeriod: parseInt(taskStats.done_this_period),
        pending: parseInt(taskStats.pending),
      },
      designs: {
        total: parseInt(designStats.total),
        approved: parseInt(designStats.approved),
        pendingReview: parseInt(designStats.pending_review),
        revisions: parseInt(designStats.revisions),
      },
      content: {
        total: parseInt(contentStats.total),
        published: parseInt(contentStats.published),
        approved: parseInt(contentStats.approved),
        scheduled: parseInt(contentStats.scheduled),
        drafts: parseInt(contentStats.drafts),
      },
      recentActivity: activity.rows,
      projects: projectList,
    };

    // Generate AI narrative
    let narrative = '';
    try {
      if (env.OPENAI_API_KEY) {
        const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        const prompt = `You are a professional account manager writing a ${period}ly client report.

Client: ${client.name} (${client.company || 'company'})
Period: Last ${period === 'month' ? '30 days' : '7 days'}

Data:
- Overall project progress: ${overallProgress}%
- Active projects: ${activeProjects} / ${projectList.length}
- Tasks completed this period: ${taskStats.done_this_period}, still pending: ${taskStats.pending}
- Designs: ${designStats.approved} approved, ${designStats.pending_review} pending review
- Content: ${contentStats.published} published, ${contentStats.scheduled} scheduled, ${contentStats.approved} approved

Write a professional, positive, concise report summary (3–4 sentences). Highlight wins, note any pending actions. Sound confident and professional. Do NOT include any numbers that contradict the data above.`;

        const chat = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.7,
        });
        narrative = chat.choices[0]?.message?.content?.trim() || '';
      }
    } catch { /* narrative stays empty */ }

    // Generate insights
    const insights: string[] = [];
    if (overallProgress >= 70) insights.push(`Strong progress — ${overallProgress}% overall completion`);
    if (parseInt(taskStats.done_this_period) > 0)
      insights.push(`${taskStats.done_this_period} tasks delivered this ${period}`);
    if (parseInt(contentStats.published) > 0)
      insights.push(`${contentStats.published} content pieces live`);
    if (parseInt(designStats.approved) > 0)
      insights.push(`${designStats.approved} designs approved`);
    if (parseInt(contentStats.scheduled) > 0)
      insights.push(`${contentStats.scheduled} posts scheduled`);
    if (parseInt(designStats.pending_review) > 0)
      insights.push(`${designStats.pending_review} design${parseInt(designStats.pending_review) > 1 ? 's' : ''} awaiting your review`);

    res.json({ ...reportData, narrative, insights });
  } catch (err) { next(err); }
}

/**
 * GET /api/clients/:id/insights
 * Returns AI-powered insights for a client (cached, refreshes every 6h)
 */
export async function getInsights(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgId = req.user!.orgId;

    // Check cache
    const cached = await pool.query(
      `SELECT insights, generated_at FROM client_insights
       WHERE client_id = $1 AND generated_at > NOW() - INTERVAL '6 hours'
       ORDER BY generated_at DESC LIMIT 1`,
      [id]
    );
    if (cached.rows[0]) {
      res.json({ insights: cached.rows[0].insights, cached: true });
      return;
    }

    // Generate fresh insights
    const [clientRes, statsRes] = await Promise.all([
      pool.query('SELECT name, company FROM clients WHERE id = $1 AND org_id = $2', [id, orgId]),
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM projects WHERE client_id = $1 AND status='active') as active_projects,
           (SELECT COUNT(*) FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE p.client_id = $1 AND t.status='done') as done_tasks,
           (SELECT COUNT(*) FROM content_pieces WHERE client_id = $1 AND status='published') as published,
           (SELECT COUNT(*) FROM design_briefs WHERE client_id = $1 AND status='client_approved') as approved_designs`,
        [id]
      ),
    ]);

    if (!clientRes.rows[0]) throw new AppError('Client not found', 404);

    const stats = statsRes.rows[0];
    const insights: string[] = [];

    // Data-driven insights
    const active = parseInt(stats.active_projects);
    const done = parseInt(stats.done_tasks);
    const pub = parseInt(stats.published);
    const des = parseInt(stats.approved_designs);

    if (active > 0) insights.push(`${active} active project${active > 1 ? 's' : ''} running smoothly`);
    if (done > 5)   insights.push(`${done} tasks completed — strong execution`);
    if (pub > 0)    insights.push(`${pub} content piece${pub > 1 ? 's' : ''} live on social media`);
    if (des > 0)    insights.push(`${des} approved design${des > 1 ? 's' : ''} delivered`);

    // Try AI-enhanced insights
    try {
      if (env.OPENAI_API_KEY && insights.length < 3) {
        const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        const r = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: `Generate 3 short positive insight phrases (max 8 words each) for a client with ${active} active projects, ${done} tasks done, ${pub} content pieces published, ${des} designs approved. Output as JSON array of strings.`,
          }],
          max_tokens: 150,
          temperature: 0.8,
        });
        const raw = r.choices[0]?.message?.content?.trim() || '[]';
        const aiInsights: string[] = JSON.parse(raw.replace(/```json?|```/g, ''));
        insights.push(...aiInsights.slice(0, 3 - insights.length));
      }
    } catch {}

    // Cache
    await pool.query(
      `INSERT INTO client_insights (org_id, client_id, insights)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [orgId, id, JSON.stringify(insights)]
    ).catch(() => {});

    res.json({ insights, cached: false });
  } catch (err) { next(err); }
}
