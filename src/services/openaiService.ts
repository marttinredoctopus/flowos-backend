import OpenAI from 'openai';
import { env } from '../config/env';
import { pool } from '../config/database';

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to your .env to enable OpenAI features.');
  }
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

// ─── Rate Limiting (per user, in-memory) ─────────────────────────────────────

const RATE_WINDOW_MS  = 60_000; // 1 minute
const RATE_MAX        = 15;     // 15 requests per minute per user

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  let bucket = rateBuckets.get(userId);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(userId, bucket);
  }

  if (bucket.count >= RATE_MAX) {
    return { allowed: false, remaining: 0, resetIn: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count++;
  return { allowed: true, remaining: RATE_MAX - bucket.count, resetIn: Math.ceil((bucket.resetAt - now) / 1000) };
}

// ─── Usage Tracking ───────────────────────────────────────────────────────────

export async function trackUsage(userId: string, orgId: string, type: string, tokensUsed: number): Promise<void> {
  await pool.query(
    `INSERT INTO ai_usage_log (user_id, org_id, type, tokens_used, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT DO NOTHING`,
    [userId, orgId, type, tokensUsed]
  ).catch(() => {}); // non-fatal
}

// ─── System Prompts by Type ───────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<string, string> = {
  ad_copy: `You are an expert performance marketer and copywriter with 10+ years of experience creating high-converting ad campaigns for Facebook, Instagram, Google, and TikTok. You write punchy, scroll-stopping copy that drives clicks and conversions. Be specific, use power words, and always include a strong CTA.`,

  content_ideas: `You are a creative content strategist and social media expert. You specialize in creating viral, engaging content ideas tailored to each platform's audience. Think in terms of trends, storytelling, and what gets people to save/share/comment.`,

  competitor_analysis: `You are a senior competitive intelligence analyst and marketing strategist. You provide detailed, structured analysis of competitors including their strengths, weaknesses, content strategy, positioning, and opportunities for the client to differentiate. Be data-driven and actionable.`,

  email: `You are an expert email marketer who crafts campaigns that achieve above-average open and click rates. You write persuasive subject lines, compelling preview text, and concise body copy that drives action. Focus on value, clarity, and strong CTAs.`,

  caption: `You are a social media content creator who writes authentic, engaging captions that feel native to each platform. You understand platform-specific tone — casual for TikTok, aspirational for Instagram, professional for LinkedIn. Always end with a hook or question to drive engagement.`,

  hashtags: `You are a social media SEO specialist who researches and selects optimal hashtags to maximize organic reach. You mix high-volume, medium-volume, and niche hashtags strategically. You understand which hashtags are oversaturated and which are actively growing.`,

  blog_outline: `You are a senior content strategist and SEO writer who creates comprehensive, well-structured blog outlines that rank on Google and provide genuine value to readers. You think in terms of search intent, E-E-A-T, and reader journey.`,

  general: `You are a versatile marketing and business consultant helping agency owners and their clients achieve their goals. Be practical, specific, and actionable.`,
};

// ─── Main Generate Function ───────────────────────────────────────────────────

export async function generateWithOpenAI(params: {
  prompt:    string;
  type:      string;
  userId?:   string;
  orgId?:    string;
  brand?:    string;
  industry?: string;
  platform?: string;
  tone?:     string;
  context?:  string;
  count?:    number;
}): Promise<{ result: string; items?: any[]; tokens_used?: number }> {
  const client = getClient();

  const systemPrompt = SYSTEM_PROMPTS[params.type] || SYSTEM_PROMPTS.general;

  // Build enhanced prompt if structured fields are provided
  let userPrompt = params.prompt;
  if (!userPrompt) {
    userPrompt = buildStructuredPrompt(params);
  }

  const response = await client.chat.completions.create({
    model:       'gpt-4o-mini',
    max_tokens:  2000,
    temperature: 0.8,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  });

  const text       = response.choices[0]?.message?.content || '';
  const tokensUsed = response.usage?.total_tokens || 0;

  // Track usage async
  if (params.userId && params.orgId) {
    trackUsage(params.userId, params.orgId, params.type, tokensUsed);
  }

  // Try to parse JSON if the response looks like it
  const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { result: text, tokens_used: tokensUsed, ...parsed };
    } catch {}
  }

  return { result: text, tokens_used: tokensUsed };
}

function buildStructuredPrompt(params: {
  type:      string;
  brand?:    string;
  industry?: string;
  platform?: string;
  tone?:     string;
  context?:  string;
  count?:    number;
}): string {
  const count = params.count || 3;
  const brand = params.brand || 'the brand';

  const structured: Record<string, string> = {
    ad_copy: `Generate ${count} high-converting ad copy variations for:
Brand: ${brand}
Platform: ${params.platform || 'Meta/Instagram'}
Industry: ${params.industry || 'general'}
Tone: ${params.tone || 'persuasive'}
${params.context ? `Campaign context: ${params.context}` : ''}

For each ad return: Headline (max 30 chars), Primary text (max 125 chars), CTA button text.
Format as JSON: { "items": [{ "headline": "...", "primary_text": "...", "cta": "..." }] }`,

    content_ideas: `Generate ${count} creative content ideas for:
Brand: ${brand}
Platform: ${params.platform || 'Instagram'}
Industry: ${params.industry || 'general'}
Tone: ${params.tone || 'engaging'}
${params.context ? `Focus: ${params.context}` : ''}

Format as JSON: { "items": ["idea 1", "idea 2", "idea 3"] }`,

    competitor_analysis: `Perform a competitive analysis:
Brand: ${brand}
Industry: ${params.industry || 'general'}
${params.context ? `Competitors to analyze: ${params.context}` : ''}

Return structured JSON with: summary, strengths, weaknesses, opportunities, threats, and 3 quick-win recommendations.`,

    email: `Write a professional marketing email for:
Brand: ${brand}
Industry: ${params.industry || 'general'}
Tone: ${params.tone || 'professional'}
${params.context ? `Purpose: ${params.context}` : ''}

Format as JSON: { "subject": "...", "preview": "...", "body": "..." }`,

    caption: `Write ${count} engaging social media captions for:
Brand: ${brand}
Platform: ${params.platform || 'Instagram'}
Tone: ${params.tone || 'authentic'}
${params.context ? `Context: ${params.context}` : ''}

Format as JSON: { "items": ["caption 1", "caption 2"] }`,

    hashtags: `Generate ${count > 10 ? count : 25} relevant hashtags for:
Brand: ${brand}
Industry: ${params.industry || 'general'}
Platform: ${params.platform || 'Instagram'}
${params.context ? `Topic: ${params.context}` : ''}

Include popular, medium, and niche hashtags. Format as JSON: { "items": ["#tag1", "#tag2"] }`,

    blog_outline: `Create a detailed SEO blog post outline for:
Brand: ${brand}
Industry: ${params.industry || 'general'}
Tone: ${params.tone || 'informative'}
${params.context ? `Topic: ${params.context}` : ''}

Format as JSON: { "title": "...", "meta_description": "...", "intro": "...", "sections": [{ "heading": "...", "points": ["..."] }], "conclusion": "..." }`,
  };

  return structured[params.type] || `Help ${brand} with: ${params.context || params.type}`;
}

// ─── Get usage summary for an org ────────────────────────────────────────────

export async function getUsageSummary(orgId: string, userId?: string): Promise<any> {
  const params: any[] = [orgId];
  let where = 'WHERE org_id = $1';
  if (userId) { params.push(userId); where += ` AND user_id = $${params.length}`; }

  const result = await pool.query(
    `SELECT
       COUNT(*) as total_requests,
       COALESCE(SUM(tokens_used), 0) as total_tokens,
       DATE_TRUNC('day', created_at) as day
     FROM ai_usage_log ${where}
     AND created_at >= NOW() - INTERVAL '30 days'
     GROUP BY day ORDER BY day DESC`,
    params
  ).catch(() => ({ rows: [] }));

  return result.rows;
}
