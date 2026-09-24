/**
 * إحاطةُ الصباح — ما تحتاجه الرئيسية فوق ما تقرؤه الشاشاتُ الأخرى.
 *
 * كلُّ رقمٍ هنا من مصدره الواحد: «عليك» من `supplier-balance.service`،
 * والدفعةُ من `payment-run.service`، والإقفالُ من `month-close`. وما لا
 * يُعرف يُقال مجهولاً: رصيدُ البنك بلا كشفٍ فيه عمودُ الرصيد `null` لا صفر.
 */
import { desc, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { monthCloses, reconciliationPeriods } from "@/db/schema";
import { buildMonthClose, type MonthCloseReport } from "@/lib/month-close";
import { gatherMonthFacts } from "@/lib/month-close-facts";

export interface CashPosition {
  /** آخرُ رصيدٍ ختاميٍّ معروف — `null` حين لا كشفَ يحمل الرصيد. */
  balanceMinor: number | null;
  /** تاريخ ذلك الرصيد (YYYY-MM-DD). */
  asOf: string | null;
}

export async function loadCashPosition(): Promise<CashPosition> {
  const [row] = await db
    .select({ closing: reconciliationPeriods.closingBalanceMinor, end: reconciliationPeriods.periodEnd })
    .from(reconciliationPeriods)
    .where(isNotNull(reconciliationPeriods.closingBalanceMinor))
    .orderBy(desc(reconciliationPeriods.periodEnd))
    .limit(1);
  return { balanceMinor: row?.closing ?? null, asOf: row?.end ?? null };
}

export interface CloseProgress {
  month: string;
  closed: boolean;
  report: MonthCloseReport;
  passed: number;
  total: number;
}

export async function loadCloseProgress(month: string): Promise<CloseProgress> {
  const [facts, closedRows] = await Promise.all([
    gatherMonthFacts(month),
    db
      .select({ month: monthCloses.month })
      .from(monthCloses)
      .where(sql`${monthCloses.month} = ${month} and ${monthCloses.status} = 'CLOSED'`)
      .limit(1),
  ]);
  const report = buildMonthClose(facts);
  return {
    month,
    closed: closedRows.length > 0,
    report,
    passed: report.items.filter((i) => i.state === "PASS").length,
    total: report.items.length,
  };
}

/** «صباح الخير» أو «مساء الخير» بساعة الرياض. */
export function greeting(at: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Riyadh" }).format(at),
  );
  return hour >= 4 && hour < 12 ? "صباح الخير" : "مساء الخير";
}

/** «الخميس، 24 سبتمبر» بتوقيت الرياض — الأرقام لاتينيّة كسائر التطبيق. */
export function longDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Riyadh",
  }).format(at);
}
