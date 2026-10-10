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
import { coverageStartFor, monthGapDays } from "./bank/coverage";
import { checkBalance } from "./bank/balance-equation";
import { monthBalances, type MonthFacts } from "./month-close";
import { ISSUE } from "./issue-codes";
import { periodKey, quarterOfMonth } from "./vat-return";
import { SETTLED_TOLERANCE_MINOR } from "./supplier-balances";

export async function gatherMonthFacts(month: string): Promise<MonthFacts> {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(`${nextMonth(month)}-01T00:00:00Z`);

  const supplierUnposted = sql`${bankTransactions.direction} = 'DEBIT'
    and ${bankTransactions.matchedPaymentId} is null
    and ${bankTransactions.matchStatus} = 'UNMATCHED'
    and (
      ${bankTransactions.category} = 'SUPPLIER'
      or (${bankTransactions.category} <> 'UNKNOWN' and ${bankTransactions.matchDisposition} in ('SUGGEST', 'REVIEW'))
    )`;

  /*
    الاستعلاماتُ لا يعتمد أحدُها على الآخر — تُطلَق معاً ويُنتظَر أطولُها،
    لا مجموعُها. والحسابُ بعدها كما كان، على النتائج نفسها.
  */
  const invP = db
    .select({
      invoiceCount: sql<number>`count(*)::int`,
      /* «لا تصلح لخصم المدخلات» ما فيه ضريبةٌ تضيع — لا فاتورةُ مورّدٍ لا يفرض ضريبة */
      notTaxValidCount: sql<number>`count(*) filter (where ${invoices.taxStatus} = 'INVALID' and ${invoices.vatMinor} > 0)::int`,
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

  const docsP = db
    .select({
      needingReview: sql<number>`count(*) filter (where ${documents.status} in ('PENDING','NEEDS_REVIEW'))::int`,
    })
    .from(documents)
    .where(eq(documents.periodMonth, month));

  // التنبيهات المانعة المفتوحة على مستندات هذا الشهر
  const blockersP = db
    .select({ n: sql<number>`count(*)::int` })
    .from(issues)
    .where(sql`${issues.status} = 'OPEN' and ${issues.severity} = 'BLOCKER' and exists (
      select 1 from documents d where d.id = ${issues}.entity_id and d.period_month = ${month}
    )`);

  /*
    من له فواتير في الشهر ووصل كشفه — لا كلُّ من وصل كشفه. كان الطرح بين
    عدّين مختلفَي الأصل يُعطي «١٠ من ١٤» والصحيح غيره.
  */
  const stmtP = db.execute<{ n: number }>(sql`
    select count(distinct i.supplier_id)::int as n
      from invoices i
     where i.period_month = ${month}
       and exists (
         select 1 from statements st
          where st.supplier_id = i.supplier_id
            and st.period_end >= ${start} and st.period_end < ${end}
       )
  `);

  /* ومنهم من على كشفه في الشهر فرقٌ مفتوح — ما يكتبه `refreshStatementFindings` */
  const stmtIssuesP = db.execute<{ n: number }>(sql`
    select count(distinct st.supplier_id)::int as n
      from statements st
      join issues iss on iss.entity_type = 'statement' and iss.entity_id = st.id and iss.status = 'OPEN'
     where st.period_end >= ${start} and st.period_end < ${end}
       and iss.code in (${ISSUE.STATEMENT_LEDGER_GAP}, ${ISSUE.STATEMENT_AMOUNT_MISMATCH}, ${ISSUE.INVOICE_IN_STATEMENT_NOT_ARCHIVED})
       and exists (select 1 from invoices i where i.supplier_id = st.supplier_id and i.period_month = ${month})
  `);

  const bankP = db
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
      /*
        صادرٌ لمورّدٍ بلا دفعة: بابُه «مورّد»، أو رجّح له المحرّكُ شيئاً ولم
        يُبتّ وبابُه معلوم (المجهولُ البابِ معدودٌ في «بلا تفسير» فوق).
      */
      supplierUnposted: sql<number>`count(*) filter (where ${supplierUnposted})::int`,
      supplierUnpostedMinor: sql<number>`coalesce(sum(${bankTransactions.amountMinor}) filter (where ${supplierUnposted}), 0)::bigint`,
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

  const importPeriodsP = db.execute<{ start: string | null; end: string | null }>(sql`
    select to_char(min(value_date), 'YYYY-MM-DD') as start,
           to_char(max(value_date), 'YYYY-MM-DD') as end
    from bank_transactions
    group by bank_import_id
  `);

  /* الرأسُ والوسطُ والذيل — `monthGapDays` تشرح لِمَ لا فترةَ حارسة */
  /*
    والتغطيةُ تبدأ من يوم فتح الحساب إن كان في الشهر: الحسابُ فُتح في مايو ٢٠٢٦ فكان الإقفالُ
    يُردّ بأيّامٍ قبل وجوده. والقاعدةُ نفسُها باقية — يومُ الفتح معلومةٌ تُكتب لا استثناء.
  */
  const openedP = db.execute<{ d: string | null }>(sql`
    select min(opened_on) as d from bank_accounts where is_active`);

  /*
    الأرصدة تُقرأ من فترة التسوية إن سُجّلت. وما لم يُسجَّل يبقى `null`
    — لا صفراً: افتراضُ الصفر يخترع فرقاً بحجم الرصيد كلِّه.
  */
  const periodsP = db.execute<{
    account: string; ps: string; pe: string; opening: number | null; closing: number | null; reviewed: boolean;
  }>(sql`
    select bank_account_id as account, period_start as ps, period_end as pe,
           opening_balance_minor as opening, closing_balance_minor as closing,
           (reviewed_at is not null) as reviewed
      from reconciliation_periods
     where period_start >= ${monthStartIso} and period_end <= ${monthEndIso}
  `);

  const quarterKey = periodKey(quarterOfMonth(month));
  const filedP = db.execute<{ n: number }>(sql`
    select count(*)::int as n from vat_filings where period_key = ${quarterKey} and voided_at is null`);

  const [
    [inv], [docs], [blockers], stmtRes, stmtIssuesRes, [bank], importPeriodsRes, openedRes, periodsRes, filedRes,
  ] = await Promise.all([
    invP, docsP, blockersP, stmtP, stmtIssuesP, bankP, importPeriodsP, openedP, periodsP, filedP,
  ]);
  const [stmt] = stmtRes.rows;
  const [stmtIssues] = stmtIssuesRes.rows;
  const [opened] = openedRes.rows;
  const [filed] = filedRes.rows;
  const periods = periodsRes.rows;

  const importPeriods = importPeriodsRes.rows
    .filter((r): r is { start: string; end: string } => r.start !== null && r.end !== null);
  const coverageStart = coverageStartFor(monthStartIso, monthEndIso, opened?.d);
  const gapDays = coverageStart === null ? 0 : monthGapDays(importPeriods, coverageStart, monthEndIso) ?? 0;

  const period = monthBalances(periods.map((p) => ({
    bankAccountId: p.account, periodStart: p.ps, periodEnd: p.pe,
    openingMinor: p.opening === null ? null : Number(p.opening),
    closingMinor: p.closing === null ? null : Number(p.closing),
    reviewed: Boolean(p.reviewed),
  })));

  const balance = checkBalance({
    openingMinor: period.openingMinor,
    closingMinor: period.closingMinor,
    creditsMinor: Number(bank?.creditsMinor ?? 0),
    debitsMinor: Number(bank?.debitsMinor ?? 0),
  });

  return {
    month,
    vatFiled: Number(filed?.n ?? 0) > 0,
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
    suppliersWithStatementIssues: Number(stmtIssues?.n ?? 0),
    bankImportCoversMonth: Number(bank?.n ?? 0) > 0,
    bankGapDays: gapDays,
    bankUnexplainedCount: Number(bank?.unexplained ?? 0),
    bankUnexplainedMinor: Number(bank?.unexplainedMinor ?? 0),
    bankSupplierUnpostedCount: Number(bank?.supplierUnposted ?? 0),
    bankSupplierUnpostedMinor: Number(bank?.supplierUnpostedMinor ?? 0),
    bankBalanceStatus: balance.status,
    bankBalanceDifferenceMinor: balance.differenceMinor,
  };
}
