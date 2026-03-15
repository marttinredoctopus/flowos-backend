import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY || '';
let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAI) genAI = new GoogleGenerativeAI(apiKey);
  return genAI;
}

export async function generateCampaignInsights(campaign: any): Promise<string> {
  if (!apiKey) return 'أضف GEMINI_API_KEY لتفعيل التحليل الذكي.';
  try {
    const model = getClient().getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `أنت خبير تسويق رقمي. حلل حملة الإعلانات التالية وقدم توصيات باللغة العربية:

الحملة: ${campaign.name}
المنصة: ${campaign.platform}
الحالة: ${campaign.status}
الميزانية: $${campaign.budget || 0}
المبلغ المنفق: $${campaign.spent || 0}
المشاهدات: ${campaign.impressions || 0}
النقرات: ${campaign.clicks || 0}
التحويلات: ${campaign.conversions || 0}
تاريخ البداية: ${campaign.start_date || 'غير محدد'}
تاريخ النهاية: ${campaign.end_date || 'غير محدد'}

قدم:
1. تحليل الأداء الحالي (3-4 جمل)
2. أبرز 3 توصيات لتحسين الحملة
3. تقدير ROI المتوقع بناءً على البيانات

اجعل ردك موجزاً وعملياً.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (e: any) {
    return `خطأ في التحليل: ${e.message}`;
  }
}

export async function competitorAnalysis(industry: string, competitors: string[], platform: string): Promise<string> {
  if (!apiKey) return 'أضف GEMINI_API_KEY لتفعيل التحليل الذكي.';
  try {
    const model = getClient().getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `أنت خبير تحليل منافسين في مجال التسويق الرقمي. قدم تحليلاً باللغة العربية:

المجال: ${industry}
المنافسون: ${competitors.join(', ')}
المنصة الإعلانية: ${platform}

قدم:
1. نقاط القوة والضعف المتوقعة لكل منافس على ${platform}
2. الفجوات التسويقية التي يمكن استغلالها
3. أفضل 3 استراتيجيات للتميز عن المنافسين
4. أنواع المحتوى والإعلانات الأكثر فاعلية في هذا المجال

اجعل التحليل دقيقاً وقابلاً للتطبيق.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (e: any) {
    return `خطأ في التحليل: ${e.message}`;
  }
}
