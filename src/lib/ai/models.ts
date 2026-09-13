/**
 * إعداد النماذج — موضعٌ واحد.
 *
 * كانت أسماء النماذج مبعثرة: `PINNED_MODELS` في `extraction/versions.ts`،
 * و`VISION_MODELS` في `statement-vision.service.ts`، وسلسلتان حرفيّتان
 * (`"deepseek-chat"` و`"qwen-max"`) في `bank/adjudicator-provider.ts`.
 * فمن بدّل نموذجاً بدّل واحداً وترك ثلاثة.
 *
 * ── المهمّة تحدّد النموذج، لا العكس ──
 *
 *   VISION     — يقرأ صورة مستند ويستخرج حقولاً. أكثر ما يُستدعى.
 *   TEXT       — يصنّف ويوحّد نصّاً قُرئ أصلاً. أرخص، ولا يحتاج عيناً.
 *   REASONING  — يوازن بين معلوماتٍ حُسبت: التحكيم، وتحليل حساب المورّد.
 *
 * ── إصدار ١٠ سبتمبر ٢٠٢٦ ──
 *
 * أصدرت DeepSeek نموذج V4.1 Flash باسم `deepseek-flash`، **متعدّد الوسائط
 * أصلاً**: يقرأ الصورة والنصّ بنموذجٍ واحد. وسُحب V4 Flash وV4 Flash
 * Vision Exp، واسماهما يُوجَّهان إلى الجديد **مؤقّتاً** — فالبقاء عليهما
 * انتظارٌ لانقطاعٍ لا يُعلَن موعده.
 *
 * فصارت الرؤية والنصّ نموذجاً واحداً، وزالت لاحقة `-exp` التي كانت
 * تجعل أكثر مسارٍ استدعاءً قائماً على نموذجٍ تجريبيّ. والاستدلال بقي
 * على `deepseek-v4-pro` — أعلنت الشركة استمراره بعد ١٤ سبتمبر بنفس
 * التسعير. وتحقّقنا من القائمة التي يعرضها مفتاح أحمد نفسه
 * (`GET /models`): النموذجان كلاهما فيها.
 *
 * والمتغيّرات (`DEEPSEEK_*_MODEL`) تبقى للطوارئ وحدها. كانت مضبوطةً في
 * Vercel بالأسماء القديمة، فتغلب الافتراضيَّ هنا بصمت — والإعداد الذي
 * يُكتب في موضعين يفترق.
 */

/** المهامّ التي تُسأل عنها النماذج. */
export type AiTask = "VISION" | "TEXT" | "REASONING";

const DEFAULT_MODELS: Record<AiTask, string> = {
  VISION: "deepseek-flash",
  TEXT: "deepseek-flash",
  REASONING: "deepseek-v4-pro",
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
      return process.env.DEEPSEEK_EXTRACTION_MODEL || DEFAULT_MODELS.VISION;
    case "TEXT":
      return process.env.DEEPSEEK_TEXT_MODEL || DEFAULT_MODELS.TEXT;
    case "REASONING":
      return process.env.DEEPSEEK_REASONING_MODEL || DEFAULT_MODELS.REASONING;
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
 * و**الـPDF ليس منها**. ١٥٧ من ١٥٨ مستنداً في الأرشيف PDF، فلا يبلغ
 * النموذجَ منها واحدٌ إلّا بعد تحويل — نصّاً يُقرأ حسابياً، أو صورةً
 * تُنتزَع.
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
 * أسعار **الذروة** (١٠ سبتمبر ٢٠٢٦، بلا خزين): المزوّد ينصفها خارج
 * الذروة، والتقدير يأخذ الأعلى كي لا يَعِد بأقلّ ممّا يُدفع. ويُراجَع
 * عند تغيّر التسعيرة، ولا يُبنى عليه قرارٌ ماليّ.
 */
export const PRICE_PER_MTOK: Record<AiTask, { input: number; output: number }> = {
  VISION: { input: 0.3, output: 1.2 },
  TEXT: { input: 0.3, output: 1.2 },
  REASONING: { input: 1.32, output: 3.96 },
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
