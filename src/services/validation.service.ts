/**
 * خدمة التحقّق: الخادم هو صاحب القرار.
 *
 * كانت واجهة الأرشفة تأخذ «هل الفاتورة ضريبية صحيحة» وقائمة التنبيهات كما
 * يرسلها المتصفّح. فكان المتصفّح هو من يقرّر، ومن يرسل قائمة فارغة يتجاوز
 * كل قاعدة مانعة. هنا يُعاد الحساب من القيم المعتمدة وحدها.
 *
 * ومخرجات النموذج تُعامَل معاملة مُدخَل غير موثوق مثلها مثل المتصفّح:
 * تُقرأ، وتُفحص، ولا يُبنى عليها قرار مالي بلا إعادة حساب.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, monthCloses } from "@/db/schema";
import { reviewConfirmed, type ConfirmedFields, type ConfirmReview } from "@/lib/confirm";
import { companyConfig } from "@/config/drive";
import { supplierContext, type SupplierContext } from "./supplier.service";

/** خطأ يُترجم إلى ٤٠٩: مانعٌ يمنع الأرشفة. */
export class BlockedError extends Error {
  readonly blockers: string[];
  constructor(blockers: string[]) {
    super(`لا يمكن الأرشفة قبل معالجة: ${blockers[0]}`);
    this.name = "BlockedError";
    this.blockers = blockers;
  }
}

/** خطأ يُترجم إلى ٤٠٩: الشهر مقفل. */
export class MonthClosedError extends Error {
  constructor(month: string) {
    super(`شهر ${month} مقفل. أعد فتحه من صفحة الإقفال إن كانت هذه فاتورة متأخّرة.`);
    this.name = "MonthClosedError";
  }
}

/** خطأ يُترجم إلى ٤٠٠. */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

/**
 * الشهر المقفل مقفل فعلاً.
 * إقفالٌ يمكن أن يُضاف إليه بعده ليس إقفالاً، والتقارير المبنيّة عليه تصير
 * كاذبة بأثر رجعي.
 */
export async function assertMonthOpen(month: string): Promise<void> {
  const [closed] = await db
    .select({ status: monthCloses.status })
    .from(monthCloses)
    .where(eq(monthCloses.month, month))
    .limit(1);
  if (closed?.status === "CLOSED") throw new MonthClosedError(month);
}

export interface ReviewResult extends ConfirmReview {
  supplier: SupplierContext | null;
}

/**
 * يفحص المستند المعتمَد فحصاً كاملاً على الخادم.
 * يرمي عند وجود مانع؛ ويرجع الحالة الضريبية المحسوبة هنا لا المرسلة.
 */
export async function reviewForArchive(fields: ConfirmedFields): Promise<ReviewResult> {
  const supplier = await supplierContext(fields.supplierId);
  if (fields.supplierId && !supplier) throw new InvalidInputError("المورد المحدَّد غير موجود");

  const trimmedNumber = fields.invoiceNumber?.trim();
  const duplicateInvoiceNumber =
    Boolean(fields.supplierId && trimmedNumber) &&
    (
      await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.supplierId, fields.supplierId!), eq(invoices.invoiceNumber, trimmedNumber!)))
        .limit(1)
    ).length > 0;

  const review = reviewConfirmed(fields, {
    companyVat: companyConfig.vatNumber,
    supplierIssuesInvoices: supplier?.issuesInvoices,
    supplierContractOnFile: supplier?.contractOnFile,
    duplicateFile: false, // تُفحص بالبصمة في DocumentService
    duplicateInvoiceNumber,
  });

  if (review.blockers.length > 0) {
    throw new BlockedError(review.blockers.map((b) => b.message));
  }

  return { ...review, supplier };
}
