/**
 * النقدُ المطلوب للأشهر الثلاثة القادمة — الوقائعُ من «النقد القادم» نفسه (`loadCashOutlook`) ومن المسيّر والتوزيع، والمتوسطاتُ
 * من كشف البنك. والبناءُ في `lib/finance/cash-need.ts` الخالصة (`docs/decisions/finance.md`).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { addMonths } from "@/lib/filing";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { bankAverages, buildCashNeed, CASH_NEED_MONTHS, coverageOf, type BankAverages, type BankMonthRow, type CashNeedPlan } from "@/lib/finance/cash-need";
import { loadPayrollDues, loadUpcomingDues, type loadCashOutlook } from "./cash-outlook.service";

export interface CashNeed {
  plan: CashNeedPlan;
  averages: BankAverages;
  balanceMinor: number | null;
  balanceAsOf: string | null;
  coverage: ReturnType<typeof coverageOf>;
}

async function loadBankMonths(months: readonly string[]): Promise<{ rows: BankMonthRow[]; lastBankDay: string | null }> {
  const list = sql.join(months.map((m) => sql`${m}`), sql`, `);
  const [rows, last] = await Promise.all([
    db.execute<{ month: string; category: string; direction: string; minor: string }>(sql`
      select to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') as month, category::text as category,
             direction::text as direction, sum(amount_minor)::bigint as minor
        from bank_transactions
       where to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') in (${list})
       group by 1, 2, 3`),
    db.execute<{ day: string | null }>(sql`select to_char(max(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as day from bank_transactions`),
  ]);
  return {
    rows: rows.rows.flatMap((r) => (r.direction === "DEBIT" || r.direction === "CREDIT" ? [{ month: r.month, category: r.category, direction: r.direction, minor: Number(r.minor) } satisfies BankMonthRow] : [])),
    lastBankDay: last.rows[0]?.day ?? null,
  };
}

/** `outlook` يُمرَّر محمَّلاً — الأداءُ يحمله سلفاً فلا يُقرأ مرّتين. */
export async function loadCashNeed(outlook: Awaited<ReturnType<typeof loadCashOutlook>>): Promise<CashNeed> {
  const today = todayInRiyadh();
  const first = today.slice(0, 7);
  const window = Array.from({ length: CASH_NEED_MONTHS }, (_, i) => addMonths(first, i));
  const past = Array.from({ length: CASH_NEED_MONTHS }, (_, i) => addMonths(first, i - CASH_NEED_MONTHS));
  const [payroll, upcoming, bank] = await Promise.all([loadPayrollDues(window), loadUpcomingDues(), loadBankMonths(past)]);
  const { recurring, overdueRun, nextRun, paidThisMonth, vat } = outlook.inputs;
  const registered = new Set(recurring.flatMap((r) => (r.category ? [r.category] : [])));
  const averages = bankAverages(bank.rows, first, bank.lastBankDay, registered);
  const sum = (xs: readonly { amountMinor: number }[]) => xs.reduce((s, x) => s + Math.max(0, x.amountMinor), 0);
  const plan = buildCashNeed({
    today,
    overdueRunMinor: sum(overdueRun),
    nextRunKnownMinor: sum(nextRun),
    supplierPerMonthMinor: averages.supplierPerMonthMinor,
    recurring, paidThisMonth, payroll, vat, upcoming,
    usualPerMonthMinor: averages.usualPerMonthMinor,
  });
  return { plan, averages, balanceMinor: outlook.balanceMinor, balanceAsOf: outlook.balanceAsOf, coverage: coverageOf(plan.totalMinor, outlook.balanceMinor) };
}
