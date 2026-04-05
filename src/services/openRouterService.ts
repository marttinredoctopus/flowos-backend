import { env } from '../config/env';

export class OpenRouterService {

  private static async chat(prompt: string, maxTokens = 2000): Promise<string> {
    if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured');

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://tasksdone.cloud',
        'X-Title': 'TasksDone',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
    }

    const data: any = await res.json();
    return data.choices[0].message.content;
  }

  static async analyzeCampaign(campaign: {
    name: string; status: string; objective?: string;
    date_start: string; date_end: string;
    spend: number; revenue: number; roas: number;
    impressions: number; clicks: number; ctr: number;
    cpc: number; cpm: number; conversions: number; frequency: number;
  }): Promise<any> {

    const prompt = `You are an expert Meta Ads performance analyst. Analyze this campaign and return a detailed JSON report with actionable insights.

Campaign: "${campaign.name}"
Status: ${campaign.status}
Objective: ${campaign.objective || 'Not specified'}
Period: ${campaign.date_start} to ${campaign.date_end}

Performance Metrics:
- Total Spend: $${Number(campaign.spend).toFixed(2)}
- Revenue Generated: $${Number(campaign.revenue).toFixed(2)}
- ROAS: ${Number(campaign.roas).toFixed(2)}x
- Impressions: ${Number(campaign.impressions).toLocaleString()}
- Clicks: ${Number(campaign.clicks).toLocaleString()}
- CTR: ${Number(campaign.ctr).toFixed(2)}%
- CPC: $${Number(campaign.cpc).toFixed(2)}
- CPM: $${Number(campaign.cpm).toFixed(2)}
- Conversions: ${Number(campaign.conversions).toLocaleString()}
- Frequency: ${Number(campaign.frequency).toFixed(2)}

Industry benchmarks for reference:
- Good ROAS: 3x+, Average: 1.5–3x, Poor: <1.5x
- Good CTR: 1%+, Average: 0.5–1%, Poor: <0.5%
- Good CPC: <$1, Average: $1–3, Poor: >$3
- Good frequency: 1.5–3, Warning: 3–5, Danger: 5+

Return ONLY this JSON (no markdown):
{
  "overall_score": 85,
  "overall_grade": "B+",
  "summary": "2-3 sentence executive summary with specific numbers",
  "performance_breakdown": {
    "roas":        { "score": 80, "status": "good",    "insight": "specific insight with numbers" },
    "ctr":         { "score": 75, "status": "warning", "insight": "specific insight with numbers" },
    "cpc":         { "score": 90, "status": "good",    "insight": "specific insight with numbers" },
    "frequency":   { "score": 85, "status": "good",    "insight": "specific insight with numbers" },
    "conversions": { "score": 70, "status": "warning", "insight": "specific insight with numbers" }
  },
  "strengths": ["specific strength 1 with data", "specific strength 2", "specific strength 3"],
  "weaknesses": ["specific weakness 1 with data", "specific weakness 2"],
  "quick_wins": [
    { "action": "Specific action title", "impact": "high", "effort": "easy", "description": "Detailed description of what to do and expected result" },
    { "action": "Specific action title", "impact": "high", "effort": "medium", "description": "Detailed description" },
    { "action": "Specific action title", "impact": "medium", "effort": "easy", "description": "Detailed description" }
  ],
  "recommendations": [
    { "title": "Recommendation title", "description": "Specific recommendation with reasoning", "priority": "high" },
    { "title": "Recommendation title", "description": "Specific recommendation", "priority": "medium" },
    { "title": "Recommendation title", "description": "Specific recommendation", "priority": "low" }
  ],
  "predicted_improvement": {
    "roas_increase": "15-25%",
    "cost_reduction": "10-20%",
    "conversion_increase": "20-30%"
  },
  "benchmark_comparison": {
    "roas_vs_industry": "above",
    "ctr_vs_industry": "below",
    "cpc_vs_industry": "average"
  }
}`;

    const json = await this.chat(prompt, 2000);
    return JSON.parse(json);
  }
}
