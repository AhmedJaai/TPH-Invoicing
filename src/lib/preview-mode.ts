/**
 * وضع المعاينة: يتخطّى تسجيل الدخول — ولا يعمل في الإنتاج مهما فُعِّل.
 *
 * كان `AUTH_BYPASS` حارساً بيئيّاً وحده: من يضيف المتغيّر في Vercel يفتح
 * كلّ الأبواب لكل من يعرف الرابط. فصار الحارس مزدوجاً — المتغيّر **و**
 * كون البيئة ليست إنتاجاً. فإن أُضيف في الإنتاج سهواً أو عمداً، لا يعمل.
 *
 * تُفصل هذه الدالة عن `session.ts` كي تُختبر بلا استدعاء طبقة المصادقة.
 */

export interface PreviewEnv {
  AUTH_BYPASS?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
}

/**
 * بيئة يُمنع فيها التخطّي مهما كان المتغيّر.
 *
 * ── ولِمَ لا يُقرأ `NODE_ENV` على Vercel ──
 *
 * كان الشرط `VERCEL_ENV === "production" || NODE_ENV === "production"`،
 * وNext.js يبني **كلّ** نشرٍ بـ`NODE_ENV=production` — المعاينةَ
 * والإنتاجَ سواء. فوضعُ المعاينة كان **متعذّراً على Vercel أصلاً**: لا
 * يعمل إلّا في `next dev` على جهازٍ محلّيّ.
 *
 * وأسوأُ من ذلك أنّ اختباراً كان يقول «يعمل في بيئة معاينة Vercel»
 * ويمرّ — لأنّه يمرّر `NODE_ENV: "development"` مع `VERCEL_ENV:
 * "preview"`، وهي حالةٌ **لا تقع في نشرٍ حقيقيّ**. فالأخضر كان يشهد
 * لتركيبةٍ لا وجود لها، والميزةُ ميّتةٌ ولا أحد يعلم.
 *
 * فصار `VERCEL_ENV` هو الحاكم حيث يوجد: هو الذي يفرّق المعاينةَ من
 * الإنتاج على Vercel، و`NODE_ENV` لا يفرّق بينهما. وحيث لا وجود له
 * (بناءٌ مستضاف بنفسه يُشغَّل بـ`next start`) يبقى `NODE_ENV` هو
 * الحاكم كما كان.
 *
 * والحمايةُ لم تُنقَص: إنتاجُ Vercel ممنوعٌ بنصّه، والإنتاجُ خارجه
 * ممنوعٌ بنصّه. والمسموحُ الجديد هو معاينةُ Vercel وحدها — وهي الحالة
 * التي بُنيت لها هذه الدالّة واسمُها.
 */
export function isProductionEnv(env: PreviewEnv): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}

export function previewAllowed(env: PreviewEnv): boolean {
  if (env.AUTH_BYPASS !== "true") return false;
  return !isProductionEnv(env);
}

/**
 * سبب رفض التخطّي — يُطبع في السجلّ كي لا يحتار أحد لِمَ لم يعمل.
 * `null` يعني أنّه مسموح.
 */
export function refusalReason(env: PreviewEnv): string | null {
  if (env.AUTH_BYPASS !== "true") return null;
  if (env.VERCEL_ENV === "production") return "وضع المعاينة مرفوض: البيئة إنتاج على Vercel.";
  if (!env.VERCEL_ENV && env.NODE_ENV === "production") return "وضع المعاينة مرفوض: البناء إنتاجيّ.";
  return null;
}

/**
 * دورُ وضع التجربة — المالكُ افتراضاً، و`AUTH_BYPASS_ROLE` يجرّب غيرَه.
 *
 * كانت التجربةُ مالكاً دائماً، فلم يُرَ قطّ ما يراه المحاسبُ ومديرُ المشتريات:
 * زرٌّ يظهر لمن لا يملكه، أو صفحةٌ تُفتح على «لا صلاحية» — لا يكشفه إلّا
 * دورٌ آخر. والمتغيّرُ لا أثر له خارج وضع التجربة (`previewAllowed`)، وما
 * ليس دوراً معروفاً يُرَدّ إلى المالك ولا يُخترَع له دور.
 */
export function previewRole(requested: string | undefined): "OWNER" | "ACCOUNTANT" | "PURCHASING" {
  return requested === "ACCOUNTANT" || requested === "PURCHASING" ? requested : "OWNER";
}
