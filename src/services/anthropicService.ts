import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

const API_KEY = env.ANTHROPIC_API_KEY;
const MODEL   = 'claude-sonnet-4-6'; // fast + capable for all AI tasks

function getClient(): Anthropic {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY is not set. Add it to your .env to enable AI features.');
  return new Anthropic({ apiKey: API_KEY });
}

export async function analyzeCompetitors(
  brandName: string,
  industry: string,
  competitors: string[],
  analysisTypes: string[]
): Promise<any> {
  const client = getClient();
  const prompt = `You are an expert marketing strategist and competitive intelligence analyst.

Analyze these competitors for ${brandName} in the ${industry} industry:
Competitors: ${competitors.join(', ')}
Analysis focus: ${analysisTypes.join(', ')}

Return ONLY valid JSON with this exact structure:
{
  "summary": "2-3 sentence executive summary",
  "competitors": [
    {
      "name": "competitor name",
      "strengths": ["strength 1", "strength 2"],
      "weaknesses": ["weakness 1", "weakness 2"],
      "content_strategy": "description of their content approach",
      "social_presence": "description of social media presence",
      "estimated_ad_spend": "low/medium/high or estimate",
      "key_messages": ["message 1", "message 2"],
      "opportunities_against_them": ["opportunity 1", "opportunity 2"]
    }
  ],
  "swot": {
    "strengths": ["strength for ${brandName}"],
    "weaknesses": ["weakness for ${brandName}"],
    "opportunities": ["market opportunity"],
    "threats": ["competitive threat"]
  },
  "recommendations": ["actionable recommendation 1", "recommendation 2"],
  "content_gaps": ["gap 1", "gap 2"],
  "quick_wins": ["quick win 1", "quick win 2"]
}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Invalid AI response format');
  return JSON.parse(jsonMatch[0]);
}

export async function* streamMarketResearch(
  question: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  clientContext?: string
): AsyncGenerator<string> {
  const client = getClient();
  const systemPrompt = `You are a senior marketing strategist with 15 years of experience. You specialize in helping marketing agencies grow their clients' businesses. You have deep knowledge of digital marketing, social media, content strategy, paid advertising, SEO, and brand building.

${clientContext ? `Current context: ${clientContext}` : ''}

When asked for ideas or strategies, be specific, actionable, and tailored to the agency/client context provided. Always structure your responses clearly with headers and bullet points. Keep responses focused and practical.`;

  const messages = [
    ...conversationHistory,
    { role: 'user' as const, content: question },
  ];

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    system: systemPrompt,
    messages,
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      yield chunk.delta.text;
    }
  }
}

export async function generateCampaignConcepts(params: {
  brandName: string;
  industry: string;
  objective: string;
  targetAudience: string;
  budgetRange: string;
  duration: string;
  platforms: string[];
  tone: string;
}): Promise<any> {
  const client = getClient();
  const prompt = `You are a world-class creative director and marketing strategist.

Generate 3 complete campaign concepts for this brief:
- Brand: ${params.brandName}
- Industry: ${params.industry}
- Objective: ${params.objective}
- Target Audience: ${params.targetAudience}
- Budget: ${params.budgetRange}
- Duration: ${params.duration}
- Platforms: ${params.platforms.join(', ')}
- Tone: ${params.tone}

Return ONLY valid JSON:
{
  "concepts": [
    {
      "name": "Campaign Name",
      "tagline": "Catchy tagline",
      "core_concept": "2-3 sentence description",
      "content_pillars": [
        { "pillar": "Pillar Name", "description": "What this covers" }
      ],
      "platform_tactics": {
        "platform_name": ["tactic 1", "tactic 2"]
      },
      "content_calendar_outline": [
        { "week": 1, "theme": "Week theme", "content": ["content idea 1", "idea 2"] }
      ],
      "kpis": ["KPI 1", "KPI 2"],
      "budget_allocation": {
        "category": "percentage"
      }
    }
  ]
}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Invalid AI response format');
  return JSON.parse(jsonMatch[0]);
}

// ─── Generic AI generate endpoint ─────────────────────────────────────────────

export async function generateContent(params: {
  type: 'ad_copy' | 'content_ideas' | 'email' | 'caption' | 'hashtags' | 'blog_outline';
  brand?: string;
  industry?: string;
  platform?: string;
  tone?: string;
  context?: string;
  count?: number;
}): Promise<{ result: string; items?: string[] }> {
  const client = getClient();
  const count = params.count || 3;

  const prompts: Record<string, string> = {
    ad_copy: `Generate ${count} high-converting ad copy variations for:
Brand: ${params.brand || 'the brand'}
Platform: ${params.platform || 'Meta/Instagram'}
Industry: ${params.industry || 'general'}
Tone: ${params.tone || 'professional'}
${params.context ? `Context: ${params.context}` : ''}

For each ad, provide: Headline (max 30 chars), Primary text (max 125 chars), CTA button text.
Format as JSON: { "items": [{ "headline": "...", "primary_text": "...", "cta": "..." }] }`,

    content_ideas: `Generate ${count} creative content ideas for:
Brand: ${params.brand || 'the brand'}
Platform: ${params.platform || 'Instagram'}
Industry: ${params.industry || 'general'}
Tone: ${params.tone || 'engaging'}
${params.context ? `Context: ${params.context}` : ''}

Format as JSON: { "items": ["idea 1", "idea 2", "idea 3"] }`,

    email: `Write a professional marketing email for:
Brand: ${params.brand || 'the brand'}
Industry: ${params.industry || 'general'}
Tone: ${params.tone || 'professional'}
${params.context ? `Purpose: ${params.context}` : ''}

Include subject line, preview text, and body. Format as JSON: { "subject": "...", "preview": "...", "body": "..." }`,

    caption: `Write ${count} engaging social media captions for:
Brand: ${params.brand || 'the brand'}
Platform: ${params.platform || 'Instagram'}
Tone: ${params.tone || 'engaging'}
${params.context ? `Context: ${params.context}` : ''}

Format as JSON: { "items": ["caption 1", "caption 2"] }`,

    hashtags: `Generate ${count > 10 ? count : 20} relevant hashtags for:
Brand: ${params.brand || 'the brand'}
Industry: ${params.industry || 'general'}
Platform: ${params.platform || 'Instagram'}
${params.context ? `Context: ${params.context}` : ''}

Mix of popular, niche, and branded. Format as JSON: { "items": ["#hashtag1", "#hashtag2"] }`,

    blog_outline: `Create a detailed blog post outline for:
Brand: ${params.brand || 'the brand'}
Industry: ${params.industry || 'general'}
Tone: ${params.tone || 'informative'}
${params.context ? `Topic: ${params.context}` : ''}

Format as JSON: { "title": "...", "intro": "...", "sections": [{ "heading": "...", "points": ["..."] }], "conclusion": "..." }`,
  };

  const prompt = prompts[params.type] || prompts.content_ideas;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { result: text, ...parsed };
    } catch {}
  }
  return { result: text };
}
