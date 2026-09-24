/**
 * دفعةُ الشهر من القاعدة — مصدرٌ واحد لصفحة الدفعات والرئيسية والنقد القادم.
 *
 * كانت صفحةُ `/payments` تستعلم الفواتير وتبني الدفعة بنفسها، فلو أرادت
 * الرئيسيةُ أن تقول «دفعة الشهر ١٢ ألفاً» لنسخت الاستعلام — وافترق يوماً.
 * فصار هنا، والبناءُ نفسُه في `lib/payment-run.ts` الخالصة.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, paymentAllocations, suppliers } from "@/db/schema";
import { buildPaymentRun, type PayableInvoice, type PaymentRun } from "@/lib/payment-run";
import { loadSupplierBalances } from "./supplier-balance.service";

export async function loadPaymentRun(
  month: string,
  {
    includeOlderUnpaid = true,
    creditBySupplier: credit,
  }: {
    includeOlderUnpaid?: boolean;
    /** رصيدُنا عند كلّ مورّد — يُمرَّر حين تُبنى دفعتان متتاليتان كي لا يُخصم الرصيدُ مرّتين. */
    creditBySupplier?: Map<string, number>;
  } = {},
): Promise<PaymentRun> {
  const rows = await db
    .select({
      invoiceId: invoices.id,
      supplierId: invoices.supplierId,
      supplierName: suppliers.nameAr,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth,
      totalMinor: invoices.totalMinor,
      vatMinor: invoices.vatMinor,
      taxStatus: invoices.taxStatus,
      inputVatStatus: invoices.inputVatStatus,
      allocatedMinor: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::bigint`,
      /* ما لم يُؤرشَف لم يُقَرّ — ينتظر مراجعةً أو رُفض — فلا يدخل ملفّ التحويلات */
      needsReview: sql<boolean>`coalesce(bool_or(${documents.status} <> 'ARCHIVED'), false)`,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(documents, eq(documents.id, invoices.documentId))
    .leftJoin(paymentAllocations, eq(paymentAllocations.invoiceId, invoices.id))
    .groupBy(invoices.id, suppliers.nameAr);

  /* رصيدٌ لنا عند كلّ مورّد — يُخصم من دفعته فلا يُحوَّل الريال مرّتين */
  const creditBySupplier = credit ?? new Map((await loadSupplierBalances()).map((b) => [b.supplierId, b.creditMinor]));

  return buildPaymentRun(
    rows.map<PayableInvoice>((r) => ({
      invoiceId: r.invoiceId,
      supplierId: r.supplierId,
      supplierName: r.supplierName ?? "غير محدَّد",
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      periodMonth: r.periodMonth,
      totalMinor: r.totalMinor,
      allocatedMinor: Number(r.allocatedMinor),
      taxStatus: r.taxStatus,
      inputVatStatus: r.inputVatStatus,
      vatMinor: r.vatMinor,
      needsReview: Boolean(r.needsReview),
    })),
    month,
    /* «أدرجها في دفعة أوّل الشهر» كانت خطوةً لا تُنفَّذ: ما فات شهرُه لا يدخل الدفعة أبداً */
    { creditBySupplier, includeOlderUnpaid },
  );
}
