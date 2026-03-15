import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { analyzeCompetitors, streamMarketResearch, generateCampaignConcepts } from '../services/anthropicService';

// ─── Competitor Analysis ─────────────────────────────────────────────────────

export async function runCompetitorAnalysis(req: Request, res: Response, next: NextFunction) {
  try {
    const { brandName, industry, competitors, analysisTypes, clientId } = req.body;
    if (!brandName || !industry || !competitors?.length) {
      throw new AppError('brandName, industry, and competitors are required', 400);
    }

    const results = await analyzeCompetitors(brandName, industry, competitors, analysisTypes || ['all']);

    const saved = await pool.query(
      `INSERT INTO competitor_analyses (org_id, client_id, brand_name, industry, competitors, analysis_types, results, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
      [req.user!.orgId, clientId || null, brandName, industry,
       JSON.stringify(competitors), JSON.stringify(analysisTypes || []),
       JSON.stringify(results), req.user!.id]
    );

    res.json({ ...results, analysisId: saved.rows[0].id, createdAt: saved.rows[0].created_at });
  } catch (err) { next(err); }
}

export async function listCompetitorAnalyses(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await pool.query(
      `SELECT ca.id, ca.brand_name, ca.industry, ca.competitors, ca.created_at,
              u.name as created_by_name, c.name as client_name
       FROM competitor_analyses ca
       LEFT JOIN users u ON u.id = ca.created_by
       LEFT JOIN clients c ON c.id = ca.client_id
       WHERE ca.org_id = $1 ORDER BY ca.created_at DESC`,
      [req.user!.orgId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function getCompetitorAnalysis(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await pool.query(
      'SELECT * FROM competitor_analyses WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user!.orgId]
    );
    if (!row.rows[0]) throw new AppError('Analysis not found', 404);
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}

// ─── Market Research Chat ─────────────────────────────────────────────────────

export async function listConversations(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await pool.query(
      `SELECT id, title, created_at, updated_at FROM ai_conversations
       WHERE org_id = $1 AND user_id = $2 ORDER BY updated_at DESC`,
      [req.user!.orgId, req.user!.id]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function createConversation(req: Request, res: Response, next: NextFunction) {
  try {
    const { title } = req.body;
    const row = await pool.query(
      `INSERT INTO ai_conversations (org_id, user_id, title, messages) VALUES ($1,$2,$3,'[]') RETURNING *`,
      [req.user!.orgId, req.user!.id, title || 'New Conversation']
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
}

export async function chat(req: Request, res: Response, next: NextFunction) {
  try {
    const { conversationId, message, clientContext } = req.body;
    if (!conversationId || !message) throw new AppError('conversationId and message required', 400);

    const convRow = await pool.query(
      'SELECT * FROM ai_conversations WHERE id = $1 AND org_id = $2',
      [conversationId, req.user!.orgId]
    );
    if (!convRow.rows[0]) throw new AppError('Conversation not found', 404);

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = convRow.rows[0].messages || [];

    // Set up SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let assistantResponse = '';

    for await (const chunk of streamMarketResearch(message, messages, clientContext)) {
      assistantResponse += chunk;
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }

    // Save to DB
    const updatedMessages = [
      ...messages,
      { role: 'user' as const, content: message },
      { role: 'assistant' as const, content: assistantResponse },
    ];

    // Auto-title from first message
    const title = convRow.rows[0].title === 'New Conversation' && messages.length === 0
      ? message.slice(0, 50) + (message.length > 50 ? '...' : '')
      : convRow.rows[0].title;

    await pool.query(
      'UPDATE ai_conversations SET messages = $1, title = $2, updated_at = NOW() WHERE id = $3',
      [JSON.stringify(updatedMessages), title, conversationId]
    );

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) { next(err); }
}

export async function deleteConversation(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query('DELETE FROM ai_conversations WHERE id = $1 AND org_id = $2', [req.params.id, req.user!.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ─── Campaign Generator ───────────────────────────────────────────────────────

export async function generateCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    const { brandName, industry, objective, targetAudience, budgetRange, duration, platforms, tone, clientId, projectId } = req.body;
    if (!brandName || !objective) throw new AppError('brandName and objective are required', 400);

    const concepts = await generateCampaignConcepts({
      brandName, industry, objective, targetAudience, budgetRange, duration,
      platforms: platforms || [], tone: tone || 'professional',
    });

    const saved = await pool.query(
      `INSERT INTO campaign_concepts (org_id, client_id, project_id, brand_name, objective, target_audience, budget_range, duration, platforms, tone, concepts, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, created_at`,
      [req.user!.orgId, clientId || null, projectId || null, brandName, objective,
       targetAudience, budgetRange, duration, JSON.stringify(platforms || []),
       tone, JSON.stringify(concepts), req.user!.id]
    );

    res.json({ ...concepts, conceptId: saved.rows[0].id, createdAt: saved.rows[0].created_at });
  } catch (err) { next(err); }
}

export async function listCampaignConcepts(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await pool.query(
      `SELECT cc.id, cc.brand_name, cc.objective, cc.created_at,
              u.name as created_by_name, c.name as client_name
       FROM campaign_concepts cc
       LEFT JOIN users u ON u.id = cc.created_by
       LEFT JOIN clients c ON c.id = cc.client_id
       WHERE cc.org_id = $1 ORDER BY cc.created_at DESC`,
      [req.user!.orgId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
}

export async function getCampaignConcept(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await pool.query(
      'SELECT * FROM campaign_concepts WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user!.orgId]
    );
    if (!row.rows[0]) throw new AppError('Campaign concept not found', 404);
    res.json(row.rows[0]);
  } catch (err) { next(err); }
}
