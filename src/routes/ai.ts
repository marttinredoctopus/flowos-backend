import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { campaignInsights, analyzeCompetitors, saveAdAccount, listAdAccounts } from '../controllers/aiController';
import { generateContent as generateWithAnthropic } from '../services/anthropicService';
import { generateWithOpenAI, checkRateLimit, getUsageSummary } from '../services/openaiService';
import { env } from '../config/env';

const router = Router();
router.use(authenticate);

// ─── Ad Account endpoints ─────────────────────────────────────────────────────
router.get('/ad-accounts', listAdAccounts);
router.post('/ad-accounts', saveAdAccount);
router.post('/campaign-insights/:id', campaignInsights);
router.post('/competitor-analysis', analyzeCompetitors);

// ─── GET /api/ai/status ───────────────────────────────────────────────────────
router.get('/status', (req: any, res) => {
  const openaiEnabled    = !!env.OPENAI_API_KEY;
  const anthropicEnabled = !!env.ANTHROPIC_API_KEY;
  res.json({
    ai_enabled:    openaiEnabled || anthropicEnabled,
    provider:      openaiEnabled ? 'openai' : anthropicEnabled ? 'anthropic' : 'none',
    model:         openaiEnabled ? 'gpt-4o-mini' : 'claude-sonnet-4-6',
    features: [
      'ad_copy', 'content_ideas', 'email', 'caption', 'hashtags',
      'blog_outline', 'competitor_analysis', 'campaign_generator', 'market_research',
    ],
  });
});

// ─── GET /api/ai/usage ────────────────────────────────────────────────────────
router.get('/usage', async (req: any, res): Promise<void> => {
  try {
    const data = await getUsageSummary(req.user.orgId, req.user.id);
    res.json({ usage: data });
  } catch {
    res.json({ usage: [] });
  }
});

// ─── POST /api/ai/generate ────────────────────────────────────────────────────
// Supports both free-form prompt and structured field input.
// Uses OpenAI if OPENAI_API_KEY is set, falls back to Anthropic.
router.post('/generate', async (req: any, res): Promise<void> => {
  try {
    // Rate limiting per user
    const rateCheck = checkRateLimit(req.user.id);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error:    `Rate limit exceeded. Try again in ${rateCheck.resetIn}s.`,
        resetIn:  rateCheck.resetIn,
      });
      return;
    }

    const VALID_TYPES = [
      'ad_copy', 'content_ideas', 'email', 'caption',
      'hashtags', 'blog_outline', 'competitor_analysis', 'general',
    ];

    const { prompt, type = 'general', brand, industry, platform, tone, context, count } = req.body;

    if (type && !VALID_TYPES.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }

    let result: any;

    // ── OpenAI path (preferred) ──────────────────────────────────────────────
    if (env.OPENAI_API_KEY) {
      result = await generateWithOpenAI({
        prompt:   prompt || '',
        type,
        userId:   req.user.id,
        orgId:    req.user.orgId,
        brand, industry, platform, tone, context, count,
      });
    }
    // ── Anthropic fallback ───────────────────────────────────────────────────
    else if (env.ANTHROPIC_API_KEY) {
      const anthropicTypes = ['ad_copy', 'content_ideas', 'email', 'caption', 'hashtags', 'blog_outline'];
      const safeType = anthropicTypes.includes(type) ? type : 'content_ideas';
      result = await generateWithAnthropic({ type: safeType as any, brand, industry, platform, tone, context, count });
    }
    // ── No AI configured ────────────────────────────────────────────────────
    else {
      res.status(503).json({
        error: 'AI features require an API key. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to your .env.',
        setup_guide: 'https://platform.openai.com/api-keys',
      });
      return;
    }

    res.json({
      ...result,
      provider:   env.OPENAI_API_KEY ? 'openai' : 'anthropic',
      rate_limit: { remaining: rateCheck.remaining, resetIn: rateCheck.resetIn },
    });
  } catch (err: any) {
    const isNoKey  = err.message?.includes('API_KEY');
    const isQuota  = err.message?.includes('quota') || err.message?.includes('billing') || err.status === 429;

    res.status(isNoKey ? 503 : isQuota ? 402 : 500).json({
      error: isNoKey  ? 'AI API key not configured. Contact your admin.'
           : isQuota  ? 'AI quota exceeded. Please check your API billing.'
           : err.message || 'AI generation failed',
    });
  }
});

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Free-form chat with dynamic system context
router.post('/chat', async (req: any, res): Promise<void> => {
  try {
    const rateCheck = checkRateLimit(req.user.id);
    if (!rateCheck.allowed) {
      res.status(429).json({ error: `Rate limit exceeded. Try again in ${rateCheck.resetIn}s.` });
      return;
    }

    const { message, systemContext } = req.body;
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'AI features require an API key.' });
      return;
    }

    const result = await generateWithOpenAI({
      prompt: message,
      type:   'general',
      userId: req.user.id,
      orgId:  req.user.orgId,
      context: systemContext,
    });

    res.json({ result: result.result, tokens_used: result.tokens_used });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'AI chat failed' });
  }
});

export default router;
