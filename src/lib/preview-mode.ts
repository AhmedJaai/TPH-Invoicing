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

/** بيئة يُمنع فيها التخطّي مهما كان المتغيّر. */
export function isProductionEnv(env: PreviewEnv): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
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
  if (env.NODE_ENV === "production") return "وضع المعاينة مرفوض: البناء إنتاجيّ.";
  return null;
}
