/**
 * إحاطةُ الصباح — ما تحتاجه الرئيسية فوق ما تقرؤه الشاشاتُ الأخرى.
 *
 * كلُّ رقمٍ هنا من مصدره الواحد: «عليك» من `supplier-balance.service`،
 * والدفعةُ من `payment-run.service`، والإقفالُ من `month-close`. وما لا
 * يُعرف يُقال مجهولاً: رصيدُ البنك بلا كشفٍ فيه عمودُ الرصيد `null` لا صفر.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthCloses } from "@/db/schema";
import { buildMonthClose, type MonthCloseReport } from "@/lib/month-close";
import { gatherMonthFacts } from "@/lib/month-close-facts";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { balanceAsOf } from "@/lib/bank/statement-balances";

export interface CashPosition {
  /** آخرُ رصيدٍ ختاميٍّ معروف — `null` حين لا كشفَ يحمل الرصيد. */
  balanceMinor: number | null;
  /** يومُ ذلك الرصيد (YYYY-MM-DD): آخرُ حركةٍ في فترته — `null` إن لم يُعرف يومٌ ماضٍ. */
  asOf: string | null;
}

export async function loadCashPosition(): Promise<CashPosition> {
  /*
    الفترةُ شهرٌ كامل (`period_end` آخرُ يومٍ فيه) والرصيدُ رصيدُ آخر حركةٍ منه في
    الكشف — فتاريخُه يومُ تلك الحركة لا آخرُ الشهر. كانت الرئيسيّة تقول «آخر رصيد
    معروف · 31 أكتوبر» في الخامس والعشرين منه، والكشفُ يقف عند الثاني والعشرين.
  */
  const r = (await db.execute<{ closing: number | null; period_end: string; last_day: string | null }>(sql`
    select rp.closing_balance_minor as closing, rp.period_end,
           (select to_char(max(bt.value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD')
              from bank_transactions bt
             where (bt.bank_account_id = rp.bank_account_id or bt.bank_account_id is null)
               and to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')
                   between rp.period_start and rp.period_end) as last_day
      from reconciliation_periods rp
     where rp.closing_balance_minor is not null
     order by rp.period_end desc
     limit 1
  `)).rows[0];
  if (!r) return { balanceMinor: null, asOf: null };
  return {
    balanceMinor: r.closing === null ? null : Number(r.closing),
    asOf: balanceAsOf(String(r.period_end), r.last_day ? String(r.last_day) : null, todayInRiyadh()),
  };
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
