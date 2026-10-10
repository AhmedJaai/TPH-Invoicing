/**
 * دفترُ إنفاق الذكاء — الحسابُ الخالص. الكتابةُ والقراءة في `services/ai-usage.service.ts`.
 *
 * الكلفةُ تقديرٌ بالدولار من تسعيرة الذروة (`models.ts`)، تُحفظ جزءاً من مليون عدداً
 * صحيحاً. **والسقفُ اليوميّ اختياريّ** (`AI_DAILY_BUDGET_USD`): بلا ضبطٍ لا يُردّ نداء —
 * ما لم يختره صاحبُ النظام لا يُفرَض عليه؛ وإن ضبطه رُدّ ما بعده برسالةٍ تقول كم أُنفق
 * وأين يُرفع السقف.
 */

export const MICRO_PER_USD = 1_000_000;

/** تقديرُ الدولار ← جزءٌ من مليون، صحيحاً (يُقرَّب إلى الأعلى: لا يُوعَد بأقلّ ممّا يُدفع). */
export function toMicroUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(usd * MICRO_PER_USD);
}

/** «1.25» بخانتين — للعرض وحده. */
export function formatUsd(microUsd: number): string {
  const cents = Math.round(microUsd / (MICRO_PER_USD / 100));
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** السقفُ اليوميّ من البيئة بالجزء من مليون — أو `null`: لا سقف. وما لا يُفهَم لا يصير صفراً يمنع كلَّ شيء. */
export function dailyBudgetMicroUsd(raw: string | undefined): number | null {
  if (!raw) return null;
  const usd = Number(raw);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return Math.round(usd * MICRO_PER_USD);
}

export type BudgetVerdict = { allowed: true } | { allowed: false; reason: string };

export function budgetVerdict(spentTodayMicroUsd: number, budgetMicroUsd: number | null): BudgetVerdict {
  if (budgetMicroUsd === null || spentTodayMicroUsd < budgetMicroUsd) return { allowed: true };
  return {
    allowed: false,
    reason:
      `بلغ إنفاقُ القارئ اليوم ${formatUsd(spentTodayMicroUsd)} دولاراً تقديراً — السقفَ الذي ضبطتَه ` +
      `(${formatUsd(budgetMicroUsd)}). يُفتح غداً من نفسه، أو ارفع AI_DAILY_BUDGET_USD في إعدادات النشر`,
  };
}
