/**
 * جمع حقائق الشهر من قاعدة البيانات.
 *
 * مفصولة عن الواجهة البرمجية عمداً: تحتاجها الصفحة أيضاً لترسم القائمة من
 * أوّل مرّة على الخادم، فلا يرى المستخدم شاشة فارغة تنتظر طلباً.
 * والحساب نفسه في month-close.ts دالة خالصة لا تلمس القاعدة.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, documents, invoices, issues } from "@/db/schema";
import { nextMonth } from "./filing";
import { analyzeCoverage } from "./bank/coverage";
import { checkBalance } from "./bank/balance-equation";
import type { MonthFacts } from "./month-close";
import { SETTLED_TOLERANCE_MINOR } from "./supplier-balances";

export async function gatherMonthFacts(month: string): Promise<MonthFacts> {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(`${nextMonth(month)}-01T00:00:00Z`);

  const [inv] = await db
    .select({
      invoiceCount: sql<number>`count(*)::int`,
      notTaxValidCount: sql<number>`count(*) filter (where ${invoices.taxStatus} = 'INVALID')::int`,
      unknownTaxCount: sql<number>`count(*) filter (where ${invoices.taxStatus} = 'UNKNOWN')::int`,
      unpostedCount: sql<number>`count(*) filter (where not ${invoices.postedToAccounting})::int`,
      fixedAssetCount: sql<number>`count(*) filter (where ${invoices.isFixedAsset})::int`,
      suppliersWithInvoices: sql<number>`count(distinct ${invoices.supplierId})::int`,
      /* العتبة نفسها في كلّ شاشةٍ تقول «عليك»: ما بقي فوق هللة */
      unpaidCount: sql<number>`count(*) filter (where invoices.total_minor - coalesce((
        select sum(pa.amount_minor)::bigint from payment_allocations pa where pa.invoice_id = invoices.id
      ), 0) > ${SETTLED_TOLERANCE_MINOR})::int`,
      unpaidTotalMinor: sql<number>`coalesce(sum(invoices.total_minor - coalesce((
          select sum(pa.amount_minor)::bigint from payment_allocations pa where pa.invoice_id = invoices.id
        ), 0)) filter (where invoices.total_minor - coalesce((
        select sum(pa.amount_minor)::bigint from payment_allocations pa where pa.invoice_id = invoices.id
      ), 0) > ${SETTLED_TOLERANCE_MINOR}), 0)::bigint`,
    })
    .from(invoices)
    .where(eq(invoices.periodMonth, month));

  const [docs] = await db
    .select({
      needingReview: sql<number>`count(*) filter (where ${documents.status} in ('PENDING','NEEDS_REVIEW'))::int`,
    })
    .from(documents)
    .where(eq(documents.periodMonth, month));

  // التنبيهات المانعة المفتوحة على مستندات هذا الشهر
  const [blockers] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(issues)
    .where(sql`${issues.status} = 'OPEN' and ${issues.severity} = 'BLOCKER' and exists (
      select 1 from documents d where d.id = ${issues}.entity_id and d.period_month = ${month}
    )`);

  /*
    من له فواتير في الشهر ووصل كشفه — لا كلُّ من وصل كشفه. كان الطرح بين
    عدّين مختلفَي الأصل يُعطي «١٠ من ١٤» والصحيح غيره.
  */
  const [stmt] = (await db.execute<{ n: number }>(sql`
    select count(distinct i.supplier_id)::int as n
      from invoices i
     where i.period_month = ${month}
       and exists (
         select 1 from statements st
          where st.supplier_id = i.supplier_id
            and st.period_end >= ${start} and st.period_end < ${end}
       )
  `)).rows;

  const [bank] = await db
    .select({
      n: sql<number>`count(*)::int`,
      /*
        «بلا تفسير» = لم تُطابَق ولم تُصنَّف باباً معروفاً.
        و«متجاهَلة» تفسيرٌ صحيح: صاحبها قال إنّها ليست سداداً.
      */
      unexplained: sql<number>`count(*) filter (
        where ${bankTransactions.matchStatus} = 'UNMATCHED'
          and ${bankTransactions.category} = 'UNKNOWN'
      )::int`,
      unexplainedMinor: sql<number>`coalesce(sum(${bankTransactions.amountMinor}) filter (
        where ${bankTransactions.matchStatus} = 'UNMATCHED'
          and ${bankTransactions.category} = 'UNKNOWN'
      ), 0)::bigint`,
      creditsMinor: sql<number>`coalesce(sum(${bankTransactions.amountMinor})
        filter (where ${bankTransactions.direction} = 'CREDIT'), 0)::bigint`,
      debitsMinor: sql<number>`coalesce(sum(${bankTransactions.amountMinor})
        filter (where ${bankTransactions.direction} = 'DEBIT'), 0)::bigint`,
    })
    .from(bankTransactions)
    .where(and(gte(bankTransactions.valueDate, start), lt(bankTransactions.valueDate, end)));

  /*
    فجوة التغطية داخل الشهر.

    الفترات تُؤخذ من الاستيرادات نفسها — أوّل حركةٍ فيها وآخرها — ثمّ
    تُقصّ على حدود الشهر. فيوم لم يغطّه كشفٌ هو يومٌ لا نعرف ماذا جرى فيه،
    لا يومٌ لم يجرِ فيه شيء.
  */
  const monthStartIso = `${month}-01`;
  const monthEndIso = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);

  const importPeriods = (
    await db.execute<{ start: string | null; end: string | null }>(sql`
      select to_char(min(value_date), 'YYYY-MM-DD') as start,
             to_char(max(value_date), 'YYYY-MM-DD') as end
      from bank_transactions
      group by bank_import_id
    `)
  ).rows
    .filter((r): r is { start: string; end: string } => r.start !== null && r.end !== null)
    .map((r) => ({
      start: r.start < monthStartIso ? monthStartIso : r.start,
      end: r.end > monthEndIso ? monthEndIso : r.end,
    }))
    .filter((r) => r.start <= r.end);

  const gapDays = importPeriods.length === 0
    ? 0
    : (() => {
        const cov = analyzeCoverage([...importPeriods, { start: monthStartIso, end: monthStartIso }]);
        const days = cov.gaps
          .filter((g) => g.start <= monthEndIso && g.end >= monthStartIso)
          .reduce((sum, g) => sum + g.days, 0);
        /* والذيل الناقص فجوةٌ أيضاً: كشفٌ ينتهي في ٢٠ والشهر ثلاثون */
        const covered = cov.to;
        const tail = covered !== null && covered < monthEndIso
          ? Math.round(
              (new Date(`${monthEndIso}T00:00:00Z`).getTime()
                - new Date(`${covered}T00:00:00Z`).getTime()) / 86_400_000,
            )
          : 0;
        return days + tail;
      })();

  /*
    الأرصدة تُقرأ من فترة التسوية إن سُجّلت. وما لم يُسجَّل يبقى `null`
    — لا صفراً: افتراضُ الصفر يخترع فرقاً بحجم الرصيد كلِّه.
  */
  const [period] = await db.execute<{ opening: number | null; closing: number | null }>(sql`
    select sum(opening_balance_minor)::bigint as opening,
           sum(closing_balance_minor)::bigint as closing
    from reconciliation_periods
    where period_start >= ${monthStartIso} and period_end <= ${monthEndIso}
  `).then((r) => r.rows);

  const balance = checkBalance({
    openingMinor: period?.opening == null ? null : Number(period.opening),
    closingMinor: period?.closing == null ? null : Number(period.closing),
    creditsMinor: Number(bank?.creditsMinor ?? 0),
    debitsMinor: Number(bank?.debitsMinor ?? 0),
  });

  return {
    month,
    invoiceCount: Number(inv?.invoiceCount ?? 0),
    notTaxValidCount: Number(inv?.notTaxValidCount ?? 0),
    unknownTaxCount: Number(inv?.unknownTaxCount ?? 0),
    unpaidCount: Number(inv?.unpaidCount ?? 0),
    unpaidTotalMinor: Number(inv?.unpaidTotalMinor ?? 0),
    unpostedCount: Number(inv?.unpostedCount ?? 0),
    fixedAssetCount: Number(inv?.fixedAssetCount ?? 0),
    openBlockerIssues: Number(blockers?.n ?? 0),
    documentsNeedingReview: Number(docs?.needingReview ?? 0),
    suppliersWithInvoices: Number(inv?.suppliersWithInvoices ?? 0),
    suppliersWithStatement: Number(stmt?.n ?? 0),
    bankImportCoversMonth: Number(bank?.n ?? 0) > 0,
    bankGapDays: gapDays,
    bankUnexplainedCount: Number(bank?.unexplained ?? 0),
    bankUnexplainedMinor: Number(bank?.unexplainedMinor ?? 0),
    bankBalanceStatus: balance.status,
    bankBalanceDifferenceMinor: balance.differenceMinor,
  };
}
