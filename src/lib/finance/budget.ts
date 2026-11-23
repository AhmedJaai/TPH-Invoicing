/**
 * ميزانيةُ الشهر مقابلَ ما صُرف — قراءةٌ فوق «الربح» (`Pnl`)، لا تُنشئ قيداً.
 *
 * البابُ تكلفةُ المبيعات (`COGS`) أو بابُ مصروف (`TxCategory`). والساري لشهرٍ آخرُ صفٍّ يسري قبله
 * أو فيه (`effectiveBudgets`) — فالتعديلُ لا يمحو ما قبله. والمصروفُ المجهولُ (تكلفةٌ بلا جرد) «غير
 * معروف» لا صفر، فلا يُقال «ضمن الميزانية» على ما لا يُعرف.
 *
 * وفي الشهر الجاري يُقارَن بما ينبغي أن يكون صُرف **حتّى اليوم** (`pace`): ميزانيةُ ٣٠٠٠ في اليوم العاشر
 * من ثلاثين حصّتُها ألف — وألفان صُرفت «أسرع من الميزانية»، لا «ضمنها» لأنّها دون ٣٠٠٠.
 */
export interface BudgetRow {
  line: string;
  amountMinor: number | null;
  effectiveFrom: string;
  createdAt: Date;
}

/** آخرُ ما كُتب لكلّ باب ويسري في `month` — والفارغُ «لا ميزانية». */
export function effectiveBudgets(rows: readonly BudgetRow[], month: string): Map<string, number> {
  const latest = new Map<string, BudgetRow>();
  for (const r of rows) {
    if (r.effectiveFrom > month) continue;
    const cur = latest.get(r.line);
    if (!cur || r.effectiveFrom > cur.effectiveFrom || (r.effectiveFrom === cur.effectiveFrom && r.createdAt > cur.createdAt)) latest.set(r.line, r);
  }
  const out = new Map<string, number>();
  for (const [line, r] of latest) if (r.amountMinor !== null) out.set(line, r.amountMinor);
  return out;
}

export type BudgetState = "UNDER" | "NEAR" | "OVER" | "AHEAD" | "UNKNOWN";

export interface BudgetLineView {
  line: string;
  label: string;
  budgetMinor: number;
  /** ما صُرف — `null` غير معروف. */
  actualMinor: number | null;
  /** الميزانيةُ ناقصاً ما صُرف — سالبٌ تجاوز. */
  remainingMinor: number | null;
  /** النسبةُ ممّا صُرف إلى الميزانية، بنقاط الأساس. */
  usedBp: number | null;
  /** حصّةُ ما مضى من الشهر الجاري من الميزانية — `null` لشهرٍ انتهى. */
  paceMinor: number | null;
  state: BudgetState;
}

/** «قريبٌ من الحدّ» من ٩٠٪. */
export const NEAR_BP = 9_000;
/** في الشهر الجاري: أسرعُ من الميزانية حين يزيد ما صُرف على حصّة ما مضى بعشرة في المئة. */
export const AHEAD_BP = 11_000;

export function compareBudget(
  budgets: ReadonlyMap<string, number>,
  actual: (line: string) => number | null,
  label: (line: string) => string,
  progress: { elapsedDays: number; daysInMonth: number } | null,
): BudgetLineView[] {
  return [...budgets].map(([line, budgetMinor]) => {
    const a = actual(line);
    const paceMinor = progress ? Math.round((budgetMinor * progress.elapsedDays) / progress.daysInMonth) : null;
    const usedBp = a === null ? null : Math.round((a * 10_000) / budgetMinor);
    const state: BudgetState =
      a === null ? "UNKNOWN"
      : a > budgetMinor ? "OVER"
      : paceMinor !== null && paceMinor > 0 && a * 10_000 > paceMinor * AHEAD_BP ? "AHEAD"
      : usedBp !== null && usedBp >= NEAR_BP ? "NEAR"
      : "UNDER";
    return { line, label: label(line), budgetMinor, actualMinor: a, remainingMinor: a === null ? null : budgetMinor - a, usedBp, paceMinor, state };
  }).sort((x, y) => RANK[x.state] - RANK[y.state] || y.budgetMinor - x.budgetMinor);
}

const RANK: Record<BudgetState, number> = { OVER: 0, AHEAD: 1, NEAR: 2, UNKNOWN: 3, UNDER: 4 };
