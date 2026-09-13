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
import { monthOf } from "@/lib/filing";
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
import { parseStatementExtras } from "@/lib/extraction/statement-extras";
import { createPayment, findPaymentTwin } from "@/services/payment.service";
import { extractionCache, payments } from "@/db/schema";
import { can, ForbiddenError } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import type { RawLine } from "@/services/types";

export const runtime = "nodejs";

/**
 * حدٌّ للحجم ونوعٌ من قائمة سماح.
 *
 * كانت القراءة تحدّ بخمسة وعشرين ميجابايت والأرشفة تقبل أي base64 —
 * فيمرّ ما لم يُقرأ أصلاً. والنوع كان يُصدَّق من المتصفّح ويُمرَّر إلى
 * درايف كما هو، فيمكن أن يُحفظ ملفٌ بنوعٍ يخالف محتواه.
 */
/*
  الملفّ يُرسَل base64 داخل JSON (زيادة الثلث)، وحدّ المنصّة للجسم ٤٫٥
  ميجابايت. فالحدّ ٣ ميجابايت للملفّ، ويُفحَص طولُ الجسم قبل تحليله.
*/
const MAX_ARCHIVE_BYTES = 3 * 1024 * 1024;
const MAX_BODY_BYTES = Math.ceil(MAX_ARCHIVE_BYTES * 1.4) + 256 * 1024;

/**
 * البايتات الأولى تطابق النوع المعلَن — لا يُصدَّق المتصفّح في نوع الملفّ.
 */
function signatureMatches(mimeType: string, data: Buffer): boolean {
  const head = data.subarray(0, 16);
  const hex = head.toString("hex");
  if (mimeType === "application/pdf") return head.subarray(0, 5).toString("latin1") === "%PDF-";
  if (mimeType === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mimeType === "image/png") return hex.startsWith("89504e470d0a1a0a");
  if (mimeType === "image/gif") return head.subarray(0, 4).toString("latin1") === "GIF8";
  if (mimeType === "image/webp") {
    return head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
  }
  if (mimeType === "image/heic" || mimeType === "image/heif") return head.subarray(4, 8).toString("latin1") === "ftyp";
  return false;
}

/** اسمٌ لا يصعد مجلّداً ولا يُنشئ مسارات. */
const SAFE_NAME = /^(?!\.{1,2}$)[^/\\\u0000-\u001f]{1,160}$/;

const ARCHIVABLE_TYPES: readonly string[] = [
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif",
];
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
  /* سباقُ رفعين للملفّ نفسه: القيدُ الفريد ردّ الثاني — خبرٌ لا عطب */
  const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
  if (code === "23505") {
    return NextResponse.json({ error: "رُفع هذا الملف أو هذه الفاتورة للتوّ من نافذةٍ أخرى — لم يُقيَّد ثانيةً" }, { status: 409 });
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const user = await guard("archive", "document:upload");

    /* يُردّ الجسم الكبير قبل أن يُحلَّل كلّه في الذاكرة */
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) {
      throw new InvalidInputError(`الملف أكبر من ${MAX_ARCHIVE_BYTES / (1024 * 1024)} ميجابايت — صغّره ثمّ أعد المحاولة`);
    }

    let body: ArchiveBody;
    try {
      body = (await request.json()) as ArchiveBody;
    } catch {
      throw new InvalidInputError("تعذّرت قراءة الطلب. أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب.");
    }

    if (!body.fileName || !body.folderName || !MONTH_RE.test(body.periodMonth ?? "")) {
      throw new InvalidInputError("الاسم أو المجلد أو الشهر ناقص");
    }

    if (!ARCHIVABLE_TYPES.includes(body.mimeType)) {
      throw new InvalidInputError(`نوع الملف غير مقبول: ${body.mimeType}`);
    }

    if (!SAFE_NAME.test(body.fileName) || !SAFE_NAME.test(body.folderName)) {
      throw new InvalidInputError("اسم الملف أو المجلد فيه ما لا يُقبل");
    }

    /* `Buffer.from(…, "base64")` لا يرمي أبداً — فالتحقّق بالبايتات لا بـ`try` */
    const data = Buffer.from(typeof body.fileBase64 === "string" ? body.fileBase64 : "", "base64");
    if (data.length === 0) throw new InvalidInputError("الملف فارغ");
    if (!signatureMatches(body.mimeType, data)) {
      throw new InvalidInputError("محتوى الملف لا يطابق نوعه المعلَن");
    }

    /*
      إيصالُ السداد يُنشئ دفعة — كتابةُ مالٍ بصلاحية الرفع وحدها. ومدير
      المشتريات مُنع من الأرقام في كلّ شاشة ثمّ يُنشئ دفعةً من هنا.
    */
    if (PAYMENT_KINDS.has(body.documentKind) && !can(user.role, "payment:approve")) {
      throw new ForbiddenError("payment:approve");
    }
    if (data.length > MAX_ARCHIVE_BYTES) {
      throw new InvalidInputError(
        `الملف أكبر من ${MAX_ARCHIVE_BYTES / (1024 * 1024)} ميجابايت`,
      );
    }

    /*
      ── الشهر يُشتقّ في الخادم، ولا يُؤخَذ كما أرسله المتصفّح ──

      وهذا الملفّ وقع فيه هذا الخطأ مرّتين. الأولى في `isTaxValid`،
      وأُصلحت بـ`reviewConfirmed()`. والثانية هنا: `periodMonth` يُقرأ
      من الجسم ويُفحَص شكلُه (`YYYY-MM`) ثمّ يُكتَب في المستند والفاتورة
      والدفعة — بلا أن يُقابَل بتاريخ الفاتورة نفسه.

      وكشفه تدقيقُ الحقيقة على بيانات حقيقية: ستّ فواتير مؤرَّخة في
      أغسطس ٢٠٢٦ محفوظةٌ في سبتمبر — وهو **شهر رفعها**. فأغسطس ناقصٌ
      بقيمتها وسبتمبر زائد، وإقفالُ أغسطس يمرّ وهو لا يراها.

      والقاعدة مكتوبة في `CLAUDE.md` منذ البداية: «الشهر المحاسبي مشتقٌّ
      من تاريخ الفاتورة لا تاريخ الرفع». والقاعدة التي لا يفرضها الكود
      وصيّةٌ لا قاعدة.
    */
    const invoiceDate = body.invoiceDate ? new Date(`${body.invoiceDate}T00:00:00Z`) : null;

    const derivedMonth =
      invoiceDate !== null && !Number.isNaN(invoiceDate.getTime())
        ? monthOf(invoiceDate)
        /*
          وما لا تاريخ له — إيصالٌ نقديّ أو كشفٌ بلا تاريخ مقروء — يبقى
          على ما اختاره صاحبه: هو أدرى، ولا يُخترَع له شهر.
        */
        : body.periodMonth;

    const periodMonth = derivedMonth;

    /* والاختلاف يُسجَّل لا يُبتلَع: من يراجع بعد شهرٍ يعرف لِمَ تغيّر. */
    const monthCorrected =
      body.periodMonth !== periodMonth ? { أرسله: body.periodMonth, واشتُقّ: periodMonth } : null;

    // ── فحوص تسبق أي كتابة ──
    const sha256 = sha256Of(data);
    await assertNotDuplicate(sha256);

    /*
      ما قرأه النموذج من الخادم لا من المتصفّح: أسطر الكشف ورصيده و«ما
      عُدِّل يدوياً» في التدقيق تُبنى منه. وإن غاب (ملفٌّ لم يُقرأ في هذا
      الخادم) فلا أسطر ولا دعوى — لا يُصدَّق ما أُرسل بدلاً منه.
    */
    const [cached] = await db
      .select({ extraction: extractionCache.extraction, model: extractionCache.model })
      .from(extractionCache)
      .where(eq(extractionCache.sha256, sha256))
      .limit(1);
    const serverRaw = (cached?.extraction ?? null) as Record<string, unknown> | null;
    await assertMonthOpen(periodMonth);

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
      periodMonth,
      folderName: body.folderName,
      fileName: body.fileName,
      mimeType: body.mimeType,
      data,
    });

    // ── القاعدة ──
    const documentId = await db.transaction(async (tx) => {
      const docId = await createDocument(tx, {
        driveFileId: uploaded.fileId,
        driveFolderId: uploaded.folderId,
        fileName: uploaded.fileName,
        mimeType: body.mimeType,
        sizeBytes: data.length,
        sha256,
        kind: body.documentKind,
        periodMonth,
        supplierId: body.supplierId,
        rawExtraction: serverRaw ?? undefined,
        extractionModel: cached?.model ?? undefined,
        fieldConfidence: (serverRaw as { confidence?: unknown } | null)?.confidence,
        uploadedById: user.id,
      });

      if (review.canCreateInvoice && body.supplierId && invoiceDate && totalMinor !== null) {
        const invoiceId = await createInvoice(tx, {
          documentId: docId,
          supplierId: body.supplierId,
          invoiceNumber: body.invoiceNumber!.trim(),
          invoiceDate,
          periodMonth,
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

          /*
            مالٌ دفعتَه لهذا المورّد قبل وصول فاتورته يُخصم منها الآن.
            وكان لا يُخصم أبداً: الحوالة تُوزَّع يوم قيدها على ما هو مفتوح
            يومئذٍ، فتصل الفاتورة بعدها «مستحقّة» والمال عند المورّد.
            والنافذة سبعة أيّام — ما جاوزها قرارُ إنسان.
          */
          await applySupplierCredit(tx, body.supplierId, { forwardDays: SETTLEMENT_FORWARD_DAYS });
        }
      }

      if (body.documentKind === "STATEMENT" && body.supplierId && invoiceDate) {
        /*
          الأسطر والرصيد الافتتاحيّ يُقرآن من مخرَج النموذج الخام لا من
          حقلٍ يرسله المتصفّح: هي القاعدة نفسها التي في `reviewConfirmed()`
          — الخادم يشتقّ الرقم المالي ولا يصدّق ما يُملى عليه.

          وكانا يُهمَلان تماماً، فيُحفَظ الكشف برصيدٍ ختاميّ وحده وبلا
          سطر — فلا يُطابَق أبداً.
        */
        const parsed = parseStatementExtras(serverRaw);
        await createStatement(tx, {
          documentId: docId,
          supplierId: body.supplierId,
          periodEnd: invoiceDate,
          openingBalanceMinor: parsed.openingBalanceMinor,
          closingBalanceMinor: totalMinor ?? parsed.closingBalanceMinor,
          lines: parsed.lines,
        });
      }

      if (PAYMENT_KINDS.has(body.documentKind) && invoiceDate && totalMinor !== null) {
        /*
          الإيصالُ دليلٌ على دفعة، لا دفعةٌ ثانية — كما في المزامنة.
          فإن كانت الواقعةُ مقيَّدة (من الكشف أو بيد) عُلِّق عليها إن لم
          يكن لها مستند، ولم تُنشأ أخرى.
        */
        const twin = await findPaymentTwin(tx, {
          supplierId: body.supplierId ?? null,
          paidAt: invoiceDate,
          amountMinor: totalMinor,
        });
        if (twin === null) {
          await createPayment(tx, {
            documentId: docId,
            supplierId: body.supplierId,
            paidAt: invoiceDate,
            amountMinor: totalMinor,
            method: body.documentKind === "CASH_RECEIPT" ? "CASH" : "BANK_TRANSFER",
            beneficiaryNameRaw: body.beneficiary,
            appliesToMonth: periodMonth,
            acknowledgeTwin: true,
          });
        } else if (twin.documentId === null) {
          await tx.update(payments).set({ documentId: docId }).where(eq(payments.id, twin.id));
        }
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

    const corrections = diffCorrections(serverRaw ?? {}, {
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
      before: serverRaw,
      after: {
        fileName: uploaded.fileName,
        driveFileId: uploaded.fileId,
        folderName: body.folderName,
        periodMonth,
        /* الشهر المصحَّح يُسجَّل بطرفيه — لا يُبتلَع */
        ...(monthCorrected ? { الشهر_صُحّح: monthCorrected } : {}),
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
      /* ويُعاد إلى الشاشة كي يراه من رفع، لا يُصحَّح خلف ظهره */
      periodMonth,
      monthCorrected,
    });
  } catch (e) {
    const mapped = toResponse(e);
    if (mapped) return mapped;
    throw e;
  }
}
