import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { campaignInsights, analyzeCompetitors, saveAdAccount, listAdAccounts } from '../controllers/aiController';
import { generateContent } from '../services/anthropicService';

const router = Router();
router.use(authenticate);

router.get('/ad-accounts', listAdAccounts);
router.post('/ad-accounts', saveAdAccount);
router.post('/campaign-insights/:id', campaignInsights);
router.post('/competitor-analysis', analyzeCompetitors);

// ── POST /api/ai/generate ────────────────────────────────────────────────────
// Universal AI content generator
router.post('/generate', async (req: any, res): Promise<void> => {
  try {
    const { type, brand, industry, platform, tone, context, count } = req.body;
    const VALID_TYPES = ['ad_copy', 'content_ideas', 'email', 'caption', 'hashtags', 'blog_outline'];
    if (!type || !VALID_TYPES.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }
    const result = await generateContent({ type, brand, industry, platform, tone, context, count });
    res.json(result);
  } catch (err: any) {
    const isNoKey = err.message?.includes('ANTHROPIC_API_KEY');
    res.status(isNoKey ? 503 : 500).json({
      error: isNoKey
        ? 'AI features require an Anthropic API key. Contact your admin to configure it.'
        : err.message || 'AI generation failed',
    });
  }
});

// ── GET /api/ai/status ───────────────────────────────────────────────────────
router.get('/status', (req: any, res) => {
  res.json({
    ai_enabled: !!(process.env.ANTHROPIC_API_KEY),
    features: ['ad_copy', 'content_ideas', 'email', 'caption', 'hashtags', 'blog_outline',
               'competitor_analysis', 'campaign_generator', 'market_research'],
  });
});

export default router;
