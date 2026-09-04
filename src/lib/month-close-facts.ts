/**
 * جمع حقائق الشهر من قاعدة البيانات.
 *
 * مفصولة عن الواجهة البرمجية عمداً: تحتاجها الصفحة أيضاً لترسم القائمة من
 * أوّل مرّة على الخادم، فلا يرى المستخدم شاشة فارغة تنتظر طلباً.
 * والحساب نفسه في month-close.ts دالة خالصة لا تلمس القاعدة.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, documents, invoices, issues, statements } from "@/db/schema";
import { nextMonth } from "./filing";
import type { MonthFacts } from "./month-close";

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
      unpaidCount: sql<number>`count(*) filter (where ${invoices.totalMinor} > coalesce((
        select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = invoices.id
      ), 0) + 1)::int`,
      unpaidTotalMinor: sql<number>`coalesce(sum(
        greatest(0, ${invoices.totalMinor} - coalesce((
          select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = invoices.id
        ), 0))
      ) filter (where ${invoices.totalMinor} > coalesce((
        select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = invoices.id
      ), 0) + 1), 0)::int`,
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
      select 1 from documents d where d.id = ${issues.entityId} and d.period_month = ${month}
    )`);

  const [stmt] = await db
    .select({ n: sql<number>`count(distinct ${statements.supplierId})::int` })
    .from(statements)
    .where(and(gte(statements.periodEnd, start), lt(statements.periodEnd, end)));

  const [bank] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bankTransactions)
    .where(and(gte(bankTransactions.valueDate, start), lt(bankTransactions.valueDate, end)));

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
  };
}
