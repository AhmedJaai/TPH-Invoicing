/**
 * مدخلاتُ «الربح بعد كلّ ما عليك» (`lib/finance/outstanding.ts`) من أبوابها القائمة — لا حسابٌ ثانٍ:
 * رواتبُ الشهر الباقية من `loadPayrollDues` (حسابُ «النقد القادم» نفسُه)، والخصوماتُ الدوريّة من
 * `loadRecurringWatch`، والفواتيرُ المفتوحة من حقائق إقفال الشهر.
 */
import { buildOutstanding, type OutstandingView } from "@/lib/finance/outstanding";
import { gatherMonthFacts } from "@/lib/month-close-facts";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { loadPayrollDues } from "./cash-outlook.service";
import { loadRecurringWatch } from "./recurring-watch.service";

export async function loadOutstanding(month: string, profitMinor: number | null): Promise<OutstandingView> {
  const [dues, watch, facts] = await Promise.all([
    loadPayrollDues([month]),
    loadRecurringWatch(),
    /* فواتيرُ الشهر غير المسدّدة من حقائق الإقفال نفسها — «كم أدين؟» لا يُحسب في موضعٍ ثانٍ */
    gatherMonthFacts(month),
  ]);
  const due = dues.find((d) => d.month === month) ?? null;
  return buildOutstanding({
    month,
    today: todayInRiyadh(),
    profitMinor,
    payroll: due ? { owedMinor: due.amountMinor, people: due.people, unknownPeople: due.unknownPeople, undistributedMinor: due.undistributedMinor ?? 0 } : null,
    recurring: watch.series.map((s) => ({
      key: s.key, label: s.registered?.label ?? s.label, category: s.category, usualMinor: s.usualMinor,
      lastDay: s.lastDay, dayOfMonth: s.dayOfMonth, chargeDays: s.charges.map((c) => c.day),
    })),
    unpaidInvoices: { count: facts.unpaidCount, openMinor: facts.unpaidTotalMinor },
  });
}
