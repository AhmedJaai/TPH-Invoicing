/**
 * النقد القادم من القاعدة — الدفعتان من `payment-run.service`، والمتكرّرُ من
 * `recurring_expenses`، والرصيدُ من آخر فترة تسويةٍ معروفة. والبناءُ في
 * `lib/cash-outlook.ts` الخالصة.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recurringExpenses } from "@/db/schema";
import {
  buildCashOutlook, dueThisWeek, type Cadence, type CashOutlook, type RecurringInput, type SupplierDue, type WeekDue,
} from "@/lib/cash-outlook";
import { previousMonth } from "@/lib/filing";
import type { PaymentRun } from "@/lib/payment-run";
import { currentMonthRiyadh, todayInRiyadh } from "@/lib/riyadh-time";
import { loadCashPosition } from "./briefing.service";
import { loadPaymentRun } from "./payment-run.service";
import { loadSupplierBalances } from "./supplier-balance.service";

function dues(run: PaymentRun): SupplierDue[] {
  return run.ready.map((s) => ({ supplierId: s.supplierId, supplierName: s.supplierName, amountMinor: s.totalMinor }));
}

function asCadence(v: string): Cadence {
  return v === "QUARTERLY" || v === "ANNUAL" ? v : "MONTHLY";
}

/** المصروفاتُ المتكرّرة الفاعلة بصيغة الإسقاط — للنقد القادم ولـ«هذا الأسبوع» في الإحاطة. */
export async function loadRecurringInputs(): Promise<RecurringInput[]> {
  const rows = await db.select().from(recurringExpenses).where(eq(recurringExpenses.isActive, true));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    amountMinor: r.amountMinor,
    cadence: asCadence(r.cadence),
    startsOn: r.startsOn,
    endsOn: r.endsOn,
  }));
}

/**
 * ما يخرج في الأيّام السبعة القادمة — من دفعة الشهر المنقضي (محسوبةً
 * سلفاً بيد المتّصل، فالإحاطةُ تحملها) والمتكرّرِ الفاعل.
 */
export async function loadWeekDue(run: PaymentRun): Promise<WeekDue> {
  return dueThisWeek({ today: todayInRiyadh(), overdueRun: dues(run), recurring: await loadRecurringInputs() });
}

export async function loadCashOutlook(): Promise<CashOutlook & { runMonth: string; thisMonth: string }> {
  const thisMonth = currentMonthRiyadh();
  const runMonth = previousMonth(thisMonth);

  const [balances, recurring, cash] = await Promise.all([
    loadSupplierBalances(),
    loadRecurringInputs(),
    loadCashPosition(),
  ]);
  const credit = new Map(balances.map((b) => [b.supplierId, b.creditMinor]));
  const overdue = await loadPaymentRun(runMonth, { creditBySupplier: credit });
  /* ما خصمته الدفعةُ الأولى من رصيدنا لا يُخصم ثانيةً من الثانية */
  const left = new Map(credit);
  for (const s of [...overdue.ready, ...overdue.coveredByCredit]) {
    left.set(s.supplierId, Math.max(0, (left.get(s.supplierId) ?? 0) - s.creditAppliedMinor));
  }
  const next = await loadPaymentRun(thisMonth, { includeOlderUnpaid: false, creditBySupplier: left });

  const outlook = buildCashOutlook({
    today: todayInRiyadh(),
    runMonth,
    overdueRun: dues(overdue),
    heldMinor: overdue.heldTotalMinor,
    nextRun: dues(next),
    recurring,
    balanceMinor: cash.balanceMinor,
    balanceAsOf: cash.asOf,
  });
  return { ...outlook, runMonth, thisMonth };
}
