/**
 * إعداد النماذج — موضعٌ واحد.
 *
 * كانت أسماء النماذج مبعثرة: `PINNED_MODELS` في `extraction/versions.ts`،
 * و`VISION_MODELS` في `statement-vision.service.ts`، وسلسلتان حرفيّتان
 * (`"deepseek-chat"` و`"qwen-max"`) في `bank/adjudicator-provider.ts`.
 * فمن بدّل نموذجاً بدّل واحداً وترك ثلاثة.
 *
 * وكشف ذلك نفسه: الافتراضي المكتوب كان `deepseek-chat`، وحساب أحمد لا
 * يعرض هذا النموذج أصلاً — يعرض ثلاثةً غيره. فالسلسلة الحرفيّة تُكتب
 * مرّةً ثمّ لا يعود أحد يسأل أصحيحةٌ هي.
 *
 * ── المهمّة تحدّد النموذج، لا العكس ──
 *
 * ثلاث مهامّ مختلفة الطبيعة، فثلاثة نماذج:
 *
 *   VISION     — يقرأ صورة مستند ويستخرج حقولاً. أكثر ما يُستدعى.
 *   TEXT       — يصنّف ويوحّد نصّاً قُرئ أصلاً. أرخص، ولا يحتاج عيناً.
 *   REASONING  — يوازن بين مرشّحين حُسبوا. الأغلى، وللملتبس وحده.
 *
 * والتفريق ليس ترفاً: استدعاء نموذج الاستدلال على كل فاتورة يضاعف
 * الكلفة بلا فائدة، لأنّ قراءة الفاتورة ليست استدلالاً.
 */

/** المهامّ التي تُسأل عنها النماذج. */
export type AiTask = "VISION" | "TEXT" | "REASONING";

/**
 * النماذج المثبَّتة.
 *
 * لا اسم عائم في مسارٍ يقرأ أرقام فواتير. وكان في هذا النظام
 * `gemini-flash-latest` — وقد قرأ خمسة مستندات فعلاً، وهي مسجّلة في
 * `documents.extraction_model` إلى اليوم: نموذجٌ لا يُعرف ما كان.
 *
 * و`-exp` في اسم نموذج الرؤية لاحقةُ تجربة: قد يُسحَب أو يتغيّر سلوكه.
 * وهو مقبولٌ لأنّه الوحيد الذي يقرأ الصور عند هذا المزوّد — لكنّه
 * يُعلَن في `docs/` ويُراقَب، ولا يُنسى أنّه تجريبيّ.
 */
export const DEEPSEEK_MODELS: Record<AiTask, string> = {
  VISION: process.env.DEEPSEEK_EXTRACTION_MODEL || "deepseek-v4-flash-vision-exp",
  TEXT: process.env.DEEPSEEK_TEXT_MODEL || "deepseek-v4-flash",
  REASONING: process.env.DEEPSEEK_REASONING_MODEL || "deepseek-v4-pro",
};

/**
 * النموذج لمهمّة.
 *
 * دالّةٌ لا ثابت: المتغيّرات تُقرأ وقت النداء لا وقت تحميل الوحدة، وإلّا
 * جُمِّد ما قرأه أوّلُ استيراد — وهو ما يجعل الاختبار يعجز عن تبديل
 * النموذج، فيُختبَر غيرُ ما يعمل.
 */
export function modelFor(task: AiTask): string {
  switch (task) {
    case "VISION":
      return process.env.DEEPSEEK_EXTRACTION_MODEL || "deepseek-v4-flash-vision-exp";
    case "TEXT":
      return process.env.DEEPSEEK_TEXT_MODEL || "deepseek-v4-flash";
    case "REASONING":
      return process.env.DEEPSEEK_REASONING_MODEL || "deepseek-v4-pro";
  }
}

/** أصل الواجهة. يُبدَّل في الاختبار بخادمٍ محلّي. */
export function deepseekBaseUrl(): string {
  return process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
}

export function deepseekKey(): string | undefined {
  return process.env.DEEPSEEK_API_KEY;
}

/**
 * أهو مهيَّأ؟
 *
 * يُسأل قبل المحاولة كي تكون الرسالة مفيدة: «المفتاح غير مضبوط» خبرٌ
 * يُصلَح، و«الواجهة ردّت 401» تحقيقٌ يبدأ.
 */
export function isDeepseekConfigured(): boolean {
  return Boolean(deepseekKey());
}

/**
 * صيغ الصور التي يقبلها المزوّد — مثبتةٌ بالاختبار لا بالوثيقة.
 *
 * ردّ الخادم حرفيّاً حين أُرسل PDF:
 *   «has one of the following formats: webp, png, jpeg, and gif»
 *
 * و**الـPDF ليس منها**. وهذا أهمّ قيدٍ في الهجرة كلّها: ١٥٧ من ١٥٨
 * مستنداً في الأرشيف PDF، فلا يبلغ النموذجَ منها واحدٌ إلّا بعد
 * تحويل — نصّاً يُقرأ حسابياً، أو صورةً تُرسَم.
 */
export const DEEPSEEK_IMAGE_TYPES = [
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
] as const;

export function isDeepseekImageType(mimeType: string): boolean {
  return (DEEPSEEK_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

/**
 * تسعيرة المزوّد بالدولار لكل مليون رمز — لتقدير الكلفة وحده.
 *
 * تقديرٌ يُعلَن أنّه تقدير: يُراجَع عند تغيّر التسعيرة، ولا يُبنى عليه
 * قرارٌ ماليّ. وهو هنا لأنّ «كم كلّفنا هذا الشهر؟» سؤالٌ يُسأل، وجوابُه
 * بلا أرقامٍ تخمين.
 */
export const PRICE_PER_MTOK: Record<AiTask, { input: number; output: number }> = {
  VISION: { input: 0.07, output: 0.28 },
  TEXT: { input: 0.07, output: 0.28 },
  REASONING: { input: 0.28, output: 1.12 },
};

/** كلفة نداءٍ بالدولار — تقديراً. */
export function estimateCostUsd(
  task: AiTask,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
): number {
  if (!usage) return 0;
  const p = PRICE_PER_MTOK[task];
  const inTok = usage.inputTokens ?? 0;
  const outTok = usage.outputTokens ?? 0;
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}
