/**
 * حدّ الطلبات.
 *
 * واجهة التحليل تستهلك حصّة نموذج يومية، واستيراد البنك يقرأ ملفاً كبيراً
 * في الطلب الواحد. وحلقةٌ واحدة — بخطأ برمجي أو بجلسة مسروقة — تستنفد
 * حصّة اليوم فيقف عمل صاحب المقهى.
 *
 * النافذة ثابتة لا منزلقة: أبسط، وكافية هنا. والعدّ في القاعدة لا في ذاكرة
 * العملية، لأنّ البيئة السحابية تُشغّل نسخاً متعدّدة فيصير الحدّ أضعافه.
 */

export interface RateLimitRule {
  /** عدد الطلبات المسموح بها في النافذة */
  limit: number;
  /** طول النافذة بالثواني */
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** ثوانٍ حتى تتجدّد النافذة */
  retryAfterSeconds: number;
  limit: number;
}

/** بداية النافذة التي يقع فيها هذا الوقت. */
export function windowStart(at: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(at.getTime() / ms) * ms);
}

/**
 * القرار بحسب العدّ الحالي.
 * دالة خالصة: القراءة والكتابة مسؤولية المستدعي.
 */
export function decide(
  countInWindow: number,
  rule: RateLimitRule,
  at: Date,
): RateLimitDecision {
  const start = windowStart(at, rule.windowSeconds);
  const elapsed = (at.getTime() - start.getTime()) / 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil(rule.windowSeconds - elapsed));

  return {
    allowed: countInWindow <= rule.limit,
    remaining: Math.max(0, rule.limit - countInWindow),
    retryAfterSeconds,
    limit: rule.limit,
  };
}

/**
 * الحدود لكل واجهة.
 *
 * موضوعة لتمنع الحلقة لا لتضايق الاستعمال البشري: من يرفع عشرين فاتورة
 * متتابعة لا يصطدم بها، ومن يرسل ألفاً يصطدم.
 */
export const RULES: Record<string, RateLimitRule> = {
  // تستهلك حصّة النموذج — الأضيق
  analyze: { limit: 40, windowSeconds: 3600 },
  archive: { limit: 60, windowSeconds: 3600 },
  "statement-reconcile": { limit: 20, windowSeconds: 3600 },
  "drive-sync": { limit: 12, windowSeconds: 3600 },
  "bank-import": { limit: 12, windowSeconds: 3600 },
  "mark-paid": { limit: 10, windowSeconds: 3600 },
  "month-close": { limit: 30, windowSeconds: 3600 },
  "supplier-alias": { limit: 200, windowSeconds: 3600 },
  "bank-rule": { limit: 200, windowSeconds: 3600 },
  supplier: { limit: 60, windowSeconds: 3600 },
  // دِلاء منفصلة: كانت المصروفات والأصناف تستهلك حدّ المورّدين
  product: { limit: 200, windowSeconds: 3600 },
  expense: { limit: 60, windowSeconds: 3600 },
  "expense-actual": { limit: 30, windowSeconds: 3600 },
};

export function ruleFor(route: string): RateLimitRule {
  return RULES[route] ?? { limit: 120, windowSeconds: 3600 };
}
