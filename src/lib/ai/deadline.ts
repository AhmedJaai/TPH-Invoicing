/**
 * عمرُ الطلب — والنداء لا يعيش بعده.
 *
 * مهلة نداء DeepSeek ٩٠ ثانية × ثلاث محاولات، والمسار يُقتَل عند ستّين.
 * فكان يكفي ردُّ ٥٠٣ واحد لتتجاوز المحاولة الثانية عمرَ الدالّة، فتقتلها
 * المنصّة بصفحةٍ نصّية («Unexpected token») ويُدفع ثمن النداء مرّتين.
 *
 * فالمسار يعلن موعده (`withDeadline`)، وكلّ محاولة تأخذ ما بقي منه ناقصاً
 * هامشاً — ولا تُبدأ محاولةٌ لم يبقَ لها ما يكفي. «الوقوف بمهلةٍ معلَنة
 * خيرٌ من قتلٍ صامت» كان مطبَّقاً على مشي الدرايف وحده.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ deadlineAt: number }>();

export const DEADLINE_MARGIN_MS = 3_000;
export const MIN_ATTEMPT_MS = 5_000;

export function withDeadline<T>(budgetMs: number, fn: () => Promise<T>): Promise<T> {
  return store.run({ deadlineAt: Date.now() + budgetMs }, fn);
}

export function currentDeadline(): number | null {
  return store.getStore()?.deadlineAt ?? null;
}

/** مهلة المحاولة القادمة — أو `null` إن لم يبقَ ما يكفيها. */
export function attemptTimeout(defaultMs: number, deadlineAt: number | null, now = Date.now()): number | null {
  if (deadlineAt === null) return defaultMs;
  const left = deadlineAt - now - DEADLINE_MARGIN_MS;
  if (left < MIN_ATTEMPT_MS) return null;
  return Math.min(defaultMs, left);
}
