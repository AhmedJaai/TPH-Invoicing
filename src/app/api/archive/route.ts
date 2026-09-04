/**
 * الأرشفة: يرفع الملف إلى الدرايف بصلاحية المستخدم، ويسجّله في القاعدة.
 *
 * الواجهة رقيقة عمداً: تستقبل الطلب، وتترجم أخطاء الخدمات إلى رموز HTTP،
 * وتردّ. والمنطق كلّه في src/services — فكان هذا الملف يحمل أربع عشرة
 * مسؤولية في دالة واحدة، فصار ما يجري فيه غير قابل للقراءة ولا للاختبار.
 *
 * ولا يُستدعى إلا بعد تأكيد بشري صريح في شاشة المعاينة.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { isAuthBypassed } from "@/lib/session";
import { guard, respondTo } from "@/services/guard";
import { parseRiyals } from "@/lib/money";
import { diffCorrections, recordAudit } from "@/lib/audit";
import {
  assertNotDuplicate, createDocument, DuplicateDocumentError,
  recordFindings, sha256Of,
} from "@/services/document.service";
import {
  archiveToDrive, DriveUnavailableError, NoDriveAuthorizationError, UnknownYearError,
} from "@/services/drive.service";
import {
  assertMonthOpen, BlockedError, InvalidInputError, MonthClosedError, reviewForArchive,
} from "@/services/validation.service";
import { createInvoice, createStatement, replaceLines } from "@/services/invoice.service";
import { createPayment } from "@/services/payment.service";
import type { RawLine } from "@/services/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ArchiveBody {
  fileName: string;
  folderName: string;
  periodMonth: string;
  mimeType: string;
  fileBase64: string;
  documentKind: string;
  supplierId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  subtotal?: string;
  vat?: string;
  total?: string;
  sellerVat?: string;
  buyerVat?: string;
  beneficiary?: string;
  /** ما استخرجه النموذج قبل أي تعديل، للمقارنة والتدقيق */
  rawExtraction?: Record<string, unknown>;
  extractionModel?: string;
  /** تُقرأ للاطّلاع ولا يُعمل بها — الخادم يعيد حساب المانع بنفسه */
  findings?: { code: string; severity: string; message: string }[];
  lines?: Partial<RawLine>[];
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const PAYMENT_KINDS = new Set(["RECEIPT", "CASH_RECEIPT"]);

/** يترجم أخطاء الخدمات إلى ردود HTTP — الترجمة وحدها مسؤولية الواجهة. */
function toResponse(e: unknown): NextResponse | null {
  const guarded = respondTo(e);
  if (guarded) return guarded;
  if (e instanceof InvalidInputError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof UnknownYearError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof DuplicateDocumentError) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof MonthClosedError) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof BlockedError) {
    return NextResponse.json({ error: e.message, blockers: e.blockers }, { status: 409 });
  }
  if (e instanceof NoDriveAuthorizationError) {
    return NextResponse.json(
      {
        error: isAuthBypassed()
          ? "وضع التجربة لا يرفع إلى الدرايف — الرفع يحتاج حساب جوجل حقيقياً. التحليل والقراءة يعملان."
          : e.message,
      },
      { status: 428 },
    );
  }
  if (e instanceof DriveUnavailableError) return NextResponse.json({ error: e.message }, { status: 502 });
  return null;
}

export async function POST(request: Request) {
  try {
    const user = await guard("archive", "document:upload");

    let body: ArchiveBody;
    try {
      body = (await request.json()) as ArchiveBody;
    } catch {
      throw new InvalidInputError("طلب غير صالح");
    }

    if (!body.fileName || !body.folderName || !MONTH_RE.test(body.periodMonth ?? "")) {
      throw new InvalidInputError("الاسم أو المجلد أو الشهر ناقص");
    }

    let data: Buffer;
    try {
      data = Buffer.from(body.fileBase64, "base64");
    } catch {
      throw new InvalidInputError("محتوى الملف غير صالح");
    }
    if (data.length === 0) throw new InvalidInputError("الملف فارغ");

    // ── فحوص تسبق أي كتابة ──
    const sha256 = sha256Of(data);
    await assertNotDuplicate(sha256);
    await assertMonthOpen(body.periodMonth);

    const subtotalMinor = parseRiyals(body.subtotal ?? "");
    const vatMinor = parseRiyals(body.vat ?? "");
    const totalMinor = parseRiyals(body.total ?? "");

    const review = await reviewForArchive({
      documentKind: body.documentKind,
      supplierId: body.supplierId,
      invoiceNumber: body.invoiceNumber,
      invoiceDate: body.invoiceDate,
      subtotalMinor,
      vatMinor,
      totalMinor,
      sellerVat: body.sellerVat,
      buyerVat: body.buyerVat,
    });

    // ── الدرايف ──
    const uploaded = await archiveToDrive({
      userId: user.id,
      periodMonth: body.periodMonth,
      folderName: body.folderName,
      fileName: body.fileName,
      mimeType: body.mimeType,
      data,
    });

    // ── القاعدة ──
    const invoiceDate = body.invoiceDate ? new Date(`${body.invoiceDate}T00:00:00Z`) : null;

    const documentId = await db.transaction(async (tx) => {
      const docId = await createDocument(tx, {
        driveFileId: uploaded.fileId,
        driveFolderId: uploaded.folderId,
        fileName: uploaded.fileName,
        mimeType: body.mimeType,
        sizeBytes: data.length,
        sha256,
        kind: body.documentKind,
        periodMonth: body.periodMonth,
        supplierId: body.supplierId,
        rawExtraction: body.rawExtraction,
        extractionModel: body.extractionModel,
        fieldConfidence: (body.rawExtraction as { confidence?: unknown } | undefined)?.confidence,
        uploadedById: user.id,
      });

      if (review.canCreateInvoice && body.supplierId && invoiceDate && totalMinor !== null) {
        const invoiceId = await createInvoice(tx, {
          documentId: docId,
          supplierId: body.supplierId,
          invoiceNumber: body.invoiceNumber!.trim(),
          invoiceDate,
          periodMonth: body.periodMonth,
          subtotalMinor,
          vatMinor,
          totalMinor,
          sellerVat: body.sellerVat,
          buyerVat: body.buyerVat,
          taxStatus: review.taxStatus,
          inputVatStatus: review.inputVatStatus,
          isFixedAsset: review.isFixedAsset,
        });

        if (invoiceId) {
          await replaceLines(tx, {
            invoiceId,
            supplierId: body.supplierId,
            invoiceDate,
            subtotalMinor,
            lines: body.lines ?? [],
          });
        }
      }

      if (body.documentKind === "STATEMENT" && body.supplierId && invoiceDate) {
        await createStatement(tx, {
          documentId: docId,
          supplierId: body.supplierId,
          periodEnd: invoiceDate,
          closingBalanceMinor: totalMinor ?? 0,
        });
      }

      if (PAYMENT_KINDS.has(body.documentKind) && invoiceDate && totalMinor !== null) {
        await createPayment(tx, {
          documentId: docId,
          supplierId: body.supplierId,
          paidAt: invoiceDate,
          amountMinor: totalMinor,
          method: body.documentKind === "CASH_RECEIPT" ? "CASH" : "BANK_TRANSFER",
          beneficiaryNameRaw: body.beneficiary,
          appliesToMonth: body.periodMonth,
        });
      }

      /*
       * التنبيهات المسجَّلة من الخادم، ويُضاف من المتصفّح ما لا يستطيع
       * الخادم حسابه وحده: ثقة النموذج في كل حقل — وهي معلومة لا مانعة.
       */
      await recordFindings(tx, docId, [
        ...review.findings,
        ...(body.findings ?? [])
          .filter((f) => f.code === "LOW_CONFIDENCE_FIELD")
          .map((f) => ({ code: f.code as never, severity: "WARN" as const, message: f.message })),
      ]);

      return docId;
    });

    const corrections = diffCorrections(body.rawExtraction ?? {}, {
      invoiceNumber: body.invoiceNumber ?? "",
      invoiceDate: body.invoiceDate ?? "",
      totalAmount: body.total ?? "",
      vatAmount: body.vat ?? "",
    });

    await recordAudit({
      actorId: user.id,
      action: "DOCUMENT_ARCHIVED",
      entityType: "document",
      entityId: documentId,
      before: body.rawExtraction ?? null,
      after: {
        fileName: uploaded.fileName,
        driveFileId: uploaded.fileId,
        folderName: body.folderName,
        periodMonth: body.periodMonth,
        الحالة_الضريبية: review.taxStatus,
        خصم_المدخلات: review.inputVatStatus,
        manualCorrections: corrections,
      },
    });

    return NextResponse.json({
      ok: true,
      documentId,
      fileName: uploaded.fileName,
      renamed: uploaded.renamed,
      driveFileId: uploaded.fileId,
      webViewLink: uploaded.webViewLink,
      taxStatus: review.taxStatus,
      correctedFields: Object.keys(corrections),
    });
  } catch (e) {
    const mapped = toResponse(e);
    if (mapped) return mapped;
    throw e;
  }
}
