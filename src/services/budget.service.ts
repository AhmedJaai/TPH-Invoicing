/**
 * ميزانيةُ الشهر — قراءتُها مقابلَ «الربح» (`loadPnl`) وكتابتُها صفّاً جديداً بسجلّه.
 * لا تمسّ دفتراً: تقول «هل صرفتُ أكثر ممّا كتبتُ لنفسي؟» ولا تغيّر رقماً.
 */
import { asc, eq } from "drizzle-orm";
import { createId } from "@/lib/id";
import { db } from "@/db";
import { appSettings, budgetLines } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { compareBudget, effectiveBudgets, type BudgetLineView, type BudgetRow } from "@/lib/finance/budget";
import { currentMonthRiyadh, todayInRiyadh } from "@/lib/riyadh-time";
import { loadPnl } from "./profit.service";

/** الأبوابُ التي تُكتب لها ميزانية: تكلفةُ المبيعات، ومصروفاتُ التشغيل — لا سدادُ المورّد ولا حركاتُ الشبكة. */
export const BUDGET_LINES = ["COGS", "SALARY", "RENT", "UTILITY", "GOVERNMENT", "OTHER", "PERSONAL", "ZAKAT"] as const;
export type BudgetLine = (typeof BUDGET_LINES)[number];

export function budgetLabel(line: string): string {
  return line === "COGS" ? "تكلفة المبيعات" : CATEGORY_LABEL[line as TxCategory] ?? line;
}

export async function loadBudgetRows(): Promise<BudgetRow[]> {
  const rows = await db.select({
    line: budgetLines.line, amountMinor: budgetLines.amountMinor, effectiveFrom: budgetLines.effectiveFrom, createdAt: budgetLines.createdAt,
  }).from(budgetLines).orderBy(asc(budgetLines.createdAt));
  return rows;
}

export interface BudgetView {
  month: string;
  open: boolean;
  lines: BudgetLineView[];
  /** الساري الآن لكلّ باب — لنموذج التعديل. */
  current: Record<string, number | null>;
}

export async function loadBudgetView(month: string): Promise<BudgetView> {
  const [rows, view] = await Promise.all([loadBudgetRows(), loadPnl(month)]);
  const pnl = view.pnl;
  const budgets = effectiveBudgets(rows, month);
  const open = month === currentMonthRiyadh();
  const actual = (line: string): number | null => {
    if (line === "COGS") return pnl.cogsMinor;
    const row = pnl.opexByCategory.find((c) => c.category === line);
    return row ? row.amountMinor : 0;
  };
  const day = Number(todayInRiyadh().slice(8, 10));
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const nowBudgets = effectiveBudgets(rows, currentMonthRiyadh());
  return {
    month,
    open,
    lines: compareBudget(budgets, actual, budgetLabel, open ? { elapsedDays: day, daysInMonth } : null),
    current: Object.fromEntries(BUDGET_LINES.map((l) => [l, nowBudgets.get(l) ?? null])),
  };
}

/** يُكتب صفٌّ جديد يسري من `fromMonth` — والقديمُ يبقى بتاريخه. `null` يُلغي ميزانية الباب. */
export async function setBudget(actorId: string, input: { line: BudgetLine; amountMinor: number | null; fromMonth: string; note?: string | null }): Promise<void> {
  if (input.amountMinor !== null && (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0)) {
    throw new Error("اكتب مبلغاً أكبر من صفر، أو احذف الميزانية");
  }
  await db.transaction(async (t) => {
    const id = createId();
    await t.insert(budgetLines).values({
      id, line: input.line, amountMinor: input.amountMinor, effectiveFrom: input.fromMonth, note: input.note ?? null, createdById: actorId,
    });
    await recordAudit({
      actorId, action: "BUDGET_SET", entityType: "budget", entityId: input.line,
      after: { الباب: budgetLabel(input.line), "المبلغ_بالهللات": input.amountMinor, "يسري_من": input.fromMonth, ملاحظة: input.note ?? null },
    }, t);
  });
}

/*
  تجاوزُ الميزانية في «يحتاج قرارك» — يُحسب في فحص الصباح وعند كلّ حفظ، ويُحفظ؛ و«يحتاج قرارك» يقرأ
  المحفوظ ولا يعيد حسابَ الربح مع كلّ صفحة. والشهرُ الجاري «تجاوز» وحده (لا «أسرع»): التنبيهُ
  لما وقع لا لما قد يقع.
*/
const FINDINGS_KEY = "budget.findings";

export interface BudgetFinding { month: string; line: string; label: string; budgetMinor: number; actualMinor: number }

export async function refreshBudgetFindings(): Promise<BudgetFinding[]> {
  const rows = await loadBudgetRows();
  let found: BudgetFinding[] = [];
  if (rows.length > 0) {
    const current = currentMonthRiyadh();
    const v = await loadBudgetView(current);
    found = v.lines
      .filter((l) => l.state === "OVER" && l.actualMinor !== null)
      .map((l) => ({ month: current, line: l.line, label: l.label, budgetMinor: l.budgetMinor, actualMinor: l.actualMinor! }));
  }
  const value = JSON.stringify({ at: new Date().toISOString(), found });
  await db.insert(appSettings).values({ key: FINDINGS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  return found;
}

export async function loadBudgetFindings(): Promise<BudgetFinding[]> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, FINDINGS_KEY)).limit(1);
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    const list = typeof parsed === "object" && parsed !== null ? (parsed as { found?: unknown }).found : null;
    if (!Array.isArray(list)) return [];
    const current = currentMonthRiyadh();
    return list.filter((f): f is BudgetFinding =>
      typeof f === "object" && f !== null && typeof (f as BudgetFinding).line === "string" && typeof (f as BudgetFinding).budgetMinor === "number"
      && typeof (f as BudgetFinding).actualMinor === "number" && (f as BudgetFinding).month === current);
  } catch {
    return [];
  }
}
