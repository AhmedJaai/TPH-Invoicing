/**
 * دفعةُ الشهر من القاعدة — مصدرٌ واحد لصفحة الدفعات والرئيسية والنقد القادم.
 *
 * كانت صفحةُ `/payments` تستعلم الفواتير وتبني الدفعة بنفسها، فلو أرادت
 * الرئيسيةُ أن تقول «دفعة الشهر ١٢ ألفاً» لنسخت الاستعلام — وافترق يوماً.
 * فصار هنا، والبناءُ نفسُه في `lib/payment-run.ts` الخالصة.
 */
import { eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, paymentAllocations, suppliers } from "@/db/schema";
import { buildPaymentRun, type HoldOverride, type PayableInvoice, type PaymentRun } from "@/lib/payment-run";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { loadSupplierBalances } from "./supplier-balance.service";
import { loadHoldOverrides } from "./payment-hold.service";

/**
 * الفواتيرُ التي قد تدخل دفعةً حتّى شهرٍ بعينه — الاستعلامُ وحده.
 *
 * مفصولٌ عن البناء لأنّ «النقد القادم» يبني دفعتين (الشهر المنقضي والجاري) من
 * الصفوف نفسها: صفوفُ الشهر الجاري تحوي صفوفَ ما قبله، و`buildPaymentRun` تعيد
 * فحصَ الشهر والمتبقّي — فاستعلامٌ واحد يكفي الاثنتين.
 */
export async function loadPayableInvoices(month: string): Promise<PayableInvoice[]> {
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
    /*
      ما لا يدخل الدفعةَ لا يُحمَّل: كانت كلُّ فواتير التاريخ تُجلب في كلّ طلب ثمّ
      تُصفّى في الذاكرة. الشرطان هنا هما شرطا `buildPaymentRun` نفسُهما (شهرٌ حتّى
      شهر الدفعة، ومتبقٍّ فوق الهللة) — وهي تعيد فحصهما، فلا يفترقان.
    */
    .where(lte(invoices.periodMonth, month))
    .groupBy(invoices.id, suppliers.nameAr)
    .having(sql`${invoices.totalMinor} - coalesce(sum(${paymentAllocations.amountMinor}), 0) > ${SETTLED_TOLERANCE_MINOR}`);

  return rows.map<PayableInvoice>((r) => ({
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
  }));
}

export async function loadPaymentRun(
  month: string,
  {
    includeOlderUnpaid = true,
    creditBySupplier: credit,
    excludeInvoiceIds,
    overrides: givenOverrides,
  }: {
    includeOlderUnpaid?: boolean;
    /** رصيدُنا عند كلّ مورّد — يُمرَّر حين تُبنى دفعتان متتاليتان كي لا يُخصم الرصيدُ مرّتين. */
    creditBySupplier?: Map<string, number>;
    /** فواتيرُ جاهزةٌ استثناها صاحبُ الدفعة هذه المرّة (معرّفاتٌ من المتصفّح، والمبالغُ من هنا). */
    excludeInvoiceIds?: ReadonlySet<string>;
    /** قراراتُ المالك في المحجوز — تُمرَّر حين قُرئت من قبل، وإلّا تُقرأ هنا. */
    overrides?: ReadonlyMap<string, HoldOverride>;
  } = {},
): Promise<PaymentRun> {
  /*
    الصفوفُ والرصيدُ وقراراتُ المالك لا يعتمد أحدُها على الآخر — تُجلَب معاً.

    رصيدٌ لنا عند كلّ مورّد يُخصم من دفعته فلا يُحوَّل الريال مرّتين. وما أدخله
    المالكُ بقراره يدخل في كلّ شاشةٍ تقرأ الدفعة (الصفحة والملفّ والرئيسيّة والنقد
    القادم) — وإلّا قال الملفُّ رقماً والرئيسيّةُ غيرَه.
  */
  const [payable, creditBySupplier, overrides] = await Promise.all([
    loadPayableInvoices(month),
    credit ?? loadSupplierBalances().then((bs) => new Map(bs.map((b) => [b.supplierId, b.creditMinor]))),
    givenOverrides ?? loadHoldOverrides(),
  ]);

  return buildPaymentRun(
    payable,
    month,
    /* «أدرجها في دفعة أوّل الشهر» كانت خطوةً لا تُنفَّذ: ما فات شهرُه لا يدخل الدفعة أبداً */
    { creditBySupplier, includeOlderUnpaid, overrides, excludeInvoiceIds },
  );
}
