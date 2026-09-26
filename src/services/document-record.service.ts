/**
 * قيدُ فاتورةٍ من مستندٍ بيد الإنسان — حين لم تُقيَّد من القراءة.
 *
 * مستندٌ فاتورةٌ في حقيقته ولم يُقيَّد له صفّ: التاريخُ لم يُقرأ، أو
 * المورّدُ غيرُ مسجَّل، أو صنّفه النموذجُ «عرض سعر». كان لا سبيلَ إليه إلّا
 * الرفعُ من جديد. فيُكمل الإنسانُ ما نقص، ويقيّده الخادم **بالمسار نفسه**
 * الذي يقيّد به الاستدراكُ والرفع: `reviewConfirmed` يحكم (والمتصفّحُ لا
 * يقرّر حالَ الضريبة)، و`createInvoice` يكتب (وفيه `assertMonthsOpen`)،
 * والبنودُ من القراءة المحفوظة كما هي.
 *
 * - المعاينةُ أوّلاً ولا تكتب (`preview`) — والقيدُ بإقرارٍ بعدها.
 * - مستندٌ له فاتورةٌ أو كشفٌ لا يُقيَّد ثانيةً: تُصحَّح الفاتورةُ من ملفّها.
 * - المرفوضُ لا يُقيَّد: يُعاد إلى المراجعة أوّلاً.
 * - المؤرشَفُ يُخصم من فاتورته رصيدُ المورّد كما في الاعتماد
 *   (`applySupplierCredit`)؛ وما ينتظر المراجعة يُخصم منه حين يُعتمَد.
 * - ويُكتب في السجلّ بما كُتب بيدٍ وما جاء من القراءة.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, statements, suppliers } from "@/db/schema";
import { reviewConfirmed, type ConfirmReview } from "@/lib/confirm";
import { normalizeDocumentDate } from "@/lib/document-date";
import { parseRiyals } from "@/lib/money";
import { companyConfig } from "@/config/drive";
import { createInvoice, replaceLines } from "@/services/invoice.service";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { recordAudit } from "@/lib/audit";
import type { StoredReading } from "@/services/document-backlog.service";
import type { Conn } from "@/services/types";
import { invoiceNumberKey } from "@/lib/invoice-twin";

export interface RecordByHandInput {
  documentId: string;
  kind: "TAX_INVOICE" | "SIMPLIFIED_INVOICE";
  supplierId: string;
  invoiceNumber: string;
  /** كما كُتب — `normalizeDocumentDate` يوحّده. */
  invoiceDate: string;
  /** المبالغُ نصّاً كما كُتبت — والخادمُ يحوّلها هللات. */
  subtotal?: string;
  vat?: string;
  total: string;
  sellerVat?: string;
  buyerVat?: string;
}

export class RecordRefused extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "RecordRefused";
  }
}

export interface RecordOutcome {
  review: ConfirmReview;
  month: string;
  /** للمعاينة: ما سيُكتب بالهللات، ليُعرض كما يُحفظ. */
  totalMinor: number;
  invoiceId: string | null;
}

export async function recordDocumentByHand(
  actorId: string,
  input: RecordByHandInput,
  preview: boolean,
  /* معاملةُ المستدعي في الاختبار (`withRollback`) — والكتابةُ داخلها نقطةُ حفظ */
  conn: Conn = db,
): Promise<RecordOutcome> {
  const [doc] = await conn
    .select({
      id: documents.id,
      fileName: documents.fileName,
      status: documents.status,
      kind: documents.kind,
      supplierId: documents.supplierId,
      periodMonth: documents.periodMonth,
      reading: documents.extractionJson,
      invoiceId: invoices.id,
      statementId: statements.id,
    })
    .from(documents)
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .leftJoin(statements, eq(statements.documentId, documents.id))
    .where(eq(documents.id, input.documentId))
    .limit(1);

  if (!doc) throw new RecordRefused("لا يوجد هذا المستند", 404);
  if (doc.invoiceId) throw new RecordRefused("له فاتورةٌ مقيَّدة — صحّحها من ملفّها لا بقيدٍ ثانٍ");
  if (doc.statementId) throw new RecordRefused("قُيِّد كشفاً — لا يُقيَّد فاتورةً فوقه");
  if (doc.status === "REJECTED") throw new RecordRefused("المستندُ مرفوض — أعِده إلى المراجعة أوّلاً");

  const [supplier] = await conn
    .select({ id: suppliers.id, issuesInvoices: suppliers.issuesInvoices, contractOnFile: suppliers.contractOnFile })
    .from(suppliers)
    .where(eq(suppliers.id, input.supplierId))
    .limit(1);
  if (!supplier) throw new RecordRefused("المورّدُ غير موجود — اختره من القائمة أو أنشئه", 400);

  const date = normalizeDocumentDate(input.invoiceDate);
  const number = input.invoiceNumber.trim();
  const totalMinor = parseRiyals(input.total);
  const subtotalMinor = input.subtotal?.trim() ? parseRiyals(input.subtotal) : null;
  const vatMinor = input.vat?.trim() ? parseRiyals(input.vat) : null;
  if (totalMinor === null) throw new RecordRefused("الإجماليّ لا يُقرأ مبلغاً", 400);
  if (input.subtotal?.trim() && subtotalMinor === null) throw new RecordRefused("الصافي لا يُقرأ مبلغاً", 400);
  if (input.vat?.trim() && vatMinor === null) throw new RecordRefused("الضريبة لا تُقرأ مبلغاً", 400);

  /* الرقمُ نفسه بأيّ صيغة — «INV/2026/05297» هو «INV-2026-05297» */
  const key = number ? invoiceNumberKey(number) : "";
  const dupe = key
    ? (await conn.select({ id: invoices.id, number: invoices.invoiceNumber }).from(invoices)
        .where(eq(invoices.supplierId, supplier.id)))
        .find((r) => invoiceNumberKey(r.number ?? "") === key)
    : undefined;

  const review = reviewConfirmed(
    {
      documentKind: input.kind,
      supplierId: supplier.id,
      invoiceNumber: number,
      invoiceDate: date,
      subtotalMinor,
      vatMinor,
      totalMinor,
      sellerVat: input.sellerVat?.trim() || null,
      buyerVat: input.buyerVat?.trim() || null,
    },
    {
      companyVat: companyConfig.vatNumber,
      supplierIssuesInvoices: supplier.issuesInvoices,
      supplierContractOnFile: supplier.contractOnFile,
      duplicateInvoiceNumber: Boolean(dupe),
    },
  );
  const month = date ? date.slice(0, 7) : doc.periodMonth ?? "";

  if (preview || !review.canCreateInvoice || review.blockers.length > 0 || !date) {
    return { review, month, totalMinor, invoiceId: null };
  }

  const reading = (doc.reading ?? null) as StoredReading | null;
  const invoiceId = await conn.transaction(async (tx) => {
    const invoiceDate = new Date(`${date}T00:00:00Z`);
    const id = await createInvoice(tx, {
      documentId: doc.id,
      supplierId: supplier.id,
      invoiceNumber: number,
      invoiceDate,
      periodMonth: doc.periodMonth || month,
      subtotalMinor,
      vatMinor,
      totalMinor,
      sellerVat: input.sellerVat?.trim() || null,
      buyerVat: input.buyerVat?.trim() || null,
      taxStatus: review.taxStatus,
      inputVatStatus: review.inputVatStatus,
      isFixedAsset: review.isFixedAsset,
    });
    if (!id) throw new RecordRefused("قُيِّدت فاتورةٌ لهذا المستند للتوّ — حدّث الصفحة");
    await replaceLines(tx, {
      invoiceId: id,
      supplierId: supplier.id,
      invoiceDate,
      subtotalMinor,
      lines: reading?.lines ?? [],
    });
    await tx.update(documents)
      .set({ supplierId: supplier.id, kind: input.kind, periodMonth: doc.periodMonth || month })
      .where(eq(documents.id, doc.id));
    await recordAudit({
      actorId,
      action: "DOCUMENT_RECORDED_BY_HAND",
      entityType: "document",
      entityId: doc.id,
      before: { النوع: doc.kind, المورّد: doc.supplierId ?? "غير معروف" },
      after: {
        الملف: doc.fileName,
        النوع: input.kind,
        رقم_الفاتورة: number,
        التاريخ: date,
        الإجمالي: input.total,
        الحال_الضريبية: review.taxStatus,
        السبب: "أكملَ الإنسانُ ما لم يُقرأ وقُيِّدت الفاتورة",
      },
    }, tx);
    /* المؤرشَفُ اعتُمد من قبل — فيُخصم رصيدُ المورّد كما في الاعتماد */
    if (doc.status === "ARCHIVED") {
      await applySupplierCredit(tx, supplier.id, { forwardDays: SETTLEMENT_FORWARD_DAYS });
    }
    return id;
  });

  return { review, month, totalMinor, invoiceId };
}
