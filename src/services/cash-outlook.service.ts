/**
 * النقد القادم من القاعدة — الدفعتان من `payment-run.service`، والمتكرّرُ من
 * `recurring_expenses`، والرصيدُ من آخر فترة تسويةٍ معروفة. والبناءُ في
 * `lib/cash-outlook.ts` الخالصة.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recurringExpenses } from "@/db/schema";
import { buildCashOutlook, type Cadence, type CashOutlook, type SupplierDue } from "@/lib/cash-outlook";
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

export async function loadCashOutlook(): Promise<CashOutlook & { runMonth: string; thisMonth: string }> {
  const thisMonth = currentMonthRiyadh();
  const runMonth = previousMonth(thisMonth);

  const [balances, recurring, cash] = await Promise.all([
    loadSupplierBalances(),
    db.select().from(recurringExpenses).where(eq(recurringExpenses.isActive, true)),
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
    recurring: recurring.map((r) => ({
      id: r.id,
      label: r.label,
      amountMinor: r.amountMinor,
      cadence: asCadence(r.cadence),
      startsOn: r.startsOn,
      endsOn: r.endsOn,
    })),
    balanceMinor: cash.balanceMinor,
    balanceAsOf: cash.asOf,
  });
  return { ...outlook, runMonth, thisMonth };
}
