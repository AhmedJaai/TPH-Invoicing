/**
 * الرواتب للمالك وحده (أحمد، ٢٤ أكتوبر ٢٠٢٦) — في كلّ شاشةٍ لا في «الموظفون» وحدها.
 *
 * حوالاتُ باب «راتب أو أجر» ومصروفاتُه تحمل اسمَ الموظّف ومبلغَ راتبه. فمن لا يملك
 * `payroll:view` (المحاسبُ والمراجع اليوم) لا يرى سطراً منها: لا في كشف البنك، ولا في
 * المصروفات، ولا في تفصيل قائمة الدخل، ولا في حزمة المحاسب، ولا في البحث.
 *
 * **والمجموعُ يبقى** سطراً واحداً «الرواتب (المجموع)» حيث يُجمع الباب — كي تتوازن
 * الحزمةُ ويُقيَّد مصروفُ الرواتب — ولا يُعرض راتبُ أحدٍ ولا اسمُه.
 */
import { can, type Role } from "@/lib/permissions";

export const SALARY_CATEGORY = "SALARY";

export const HIDDEN_SALARY_LABEL = "الرواتب (المجموع، والتفصيل للمالك وحده)";

export function seesSalaries(role: Role | null | undefined): boolean {
  return can(role, "payroll:view");
}

export function isSalaryRow(r: { category: string }): boolean {
  return r.category === SALARY_CATEGORY;
}

/**
 * يُبقي الصفوف لمن يرى الرواتب، ولغيره يُسقط سطورَ الرواتب ويعيد عددَها ومجموعَها
 * — والمستدعي يقرّر: سطرٌ مجمَّع حيث يُجمع الباب، أو «محجوبة» حيث تُعرض حركاتٌ فرادى.
 */
export function withoutSalaryRows<T extends { category: string }>(
  rows: readonly T[],
  role: Role | null | undefined,
  amountOf: (r: T) => number,
): { rows: T[]; hidden: { count: number; totalMinor: number } } {
  if (seesSalaries(role)) return { rows: [...rows], hidden: { count: 0, totalMinor: 0 } };
  const kept: T[] = [];
  let count = 0;
  let totalMinor = 0;
  for (const r of rows) {
    if (isSalaryRow(r)) { count++; totalMinor += amountOf(r); } else kept.push(r);
  }
  return { rows: kept, hidden: { count, totalMinor } };
}

/** سطورُ الرواتب سطراً واحداً بمجموعها لمن لا يراها — حيث يُجمع البابُ (تفصيل قائمة الدخل). */
export function collapseSalaryRows<T extends { category: string; amountMinor: number }>(
  rows: readonly T[],
  role: Role | null | undefined,
  make: (totalMinor: number, count: number) => T,
): T[] {
  const { rows: kept, hidden } = withoutSalaryRows(rows, role, (r) => r.amountMinor);
  if (hidden.count === 0) return kept;
  const at = rows.findIndex(isSalaryRow);
  const out = [...kept];
  out.splice(Math.min(at, out.length), 0, make(hidden.totalMinor, hidden.count));
  return out;
}
