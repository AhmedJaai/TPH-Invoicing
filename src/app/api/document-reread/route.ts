/**
 * إعادةُ قراءة مستندٍ مؤرشف — معاينةً أوّلاً، ثمّ كتابةً بإقرار.
 *
 * ── لماذا وُجد هذا المسار ──
 *
 * ثمانِ فواتير في أرشيف المقهى **بلا بندٍ واحد**: الإجماليُّ معروفٌ ولا
 * يُعرَف ممّ تكوّن. وسبعٌ «لم تُقرأ ضريبتها». والشاشةُ كانت تقول ذلك
 * وتقف — لا زرَّ يُعيد القراءة، ولا سبيلَ إلى إصلاحه إلّا أن يُرفَع
 * الملفُّ من جديد وقد صار في الأرشيف.
 *
 * والفاتورةُ بلا بنودٍ تخرج من مقارنة الأسعار ومن تحليل الأصناف كلَّه.
 * فالنقصُ لا يقف عندها.
 *
 * ── ولا يُكتَب شيءٌ حتى يُقرّه الإنسان ──
 *
 * طلبٌ بلا `apply` يقرأ ويعرض ما قرأ، ولا يمسّ صفّاً. وبـ`apply` يكتب
 * ما عُرض. وهذا قيدٌ قائم في المشروع: «الكتابة من planned وحده،
 * والاقتراح لا يُكتَب ينتظر تأكيداً».
 *
 * **ولا يُكتَب رقمُ فاتورةٍ من النموذج** — وهو قيدٌ قديم: اختلق النموذج
 * `TPH-20260521` بثقة ١٫٠٠. فالمعادُ قراءتُه هنا البنودُ والمبالغ
 * وأرقامُ الضريبة، ويبقى رقمُ الفاتورة على ما قُيِّد. ومن أراد تصحيحه
 * كتبه بيده في `/api/invoice-fields`.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, suppliers } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import { downloadFile, driveForUser, isDriveAuthError } from "@/lib/drive";
import { refreshTokenFor } from "@/services/drive.service";
import { extractDocument, isSupportedUpload } from "@/lib/extraction";
import { withDeadline } from "@/lib/ai/deadline";
import { companyConfig } from "@/config/drive";
import { replaceLines } from "@/services/invoice.service";
import { assertMonthsOpen } from "@/services/month-guard";
import { reviewConfirmed } from "@/lib/confirm";
import { parseRiyals } from "@/lib/money";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  documentId?: string;
  /** بلا هذا: معاينةٌ لا تمسّ صفّاً. */
  apply?: boolean;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("document-reread", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }

  const id = body.documentId?.trim();
  if (!id) return NextResponse.json({ error: "لم يُذكر المستند" }, { status: 400 });

  const [doc] = await db
    .select({
      id: documents.id,
      driveFileId: documents.driveFileId,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      kind: documents.kind,
      supplierId: documents.supplierId,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth,
      issuesInvoices: suppliers.issuesInvoices,
      contractOnFile: suppliers.contractOnFile,
    })
    .from(documents)
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .where(eq(documents.id, id))
    .limit(1);

  if (!doc) return NextResponse.json({ error: "لا مستند بهذا المعرّف" }, { status: 404 });
  if (!doc.driveFileId) {
    return NextResponse.json(
      { error: "هذا المستند بلا ملفٍّ في الدرايف — لا شيء يُعاد قراءتُه." },
      { status: 409 },
    );
  }

  /*
    وضعُ التجربة لا تفويضَ درايف له عمداً (`refreshTokenFor`) — فلا يرفع
    ولا يقرأ باسم المالك من بيئةٍ بلا دخول. ويُقال ذلك صراحةً بدل أن
    يسقط بخطأٍ لا يُفهَم.
  */
  const token = await refreshTokenFor(user.id);
  if (!token) {
    return NextResponse.json(
      {
        error:
          "لا تفويضَ درايف في هذه البيئة — إعادةُ القراءة تعمل في الإنتاج وحده. "
          + "وتصحيحُ الحقول بيدك يعمل هنا.",
      },
      { status: 409 },
    );
  }

  let data: Buffer;
  let mimeType: string;
  try {
    ({ data, mimeType } = await downloadFile(driveForUser(token), doc.driveFileId));
  } catch (e) {
    if (isDriveAuthError(e)) {
      return NextResponse.json(
        { error: "انتهى تفويضُ الدرايف. اخرج وادخل بحساب جوجل ثمّ أعد المحاولة." },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: "تعذّر تنزيلُ الملفّ من الدرايف." }, { status: 502 });
  }

  if (!isSupportedUpload(mimeType)) {
    return NextResponse.json(
      { error: `نوعُ الملفّ «${mimeType}» لا يُقرأ آلياً — صحّح الحقول بيدك.` },
      { status: 415 },
    );
  }

  const supplierNames = (
    await db.select({ nameAr: suppliers.nameAr }).from(suppliers)
  ).map((s) => s.nameAr);

  /* المسار يعلن عمره، وكلّ محاولة نداءٍ تأخذ ما بقي منه. */
  const outcome = await withDeadline(55_000, () =>
    extractDocument({
      data,
      mimeType,
      companyVat: companyConfig.vatNumber,
      companyName: companyConfig.nameAr,
      supplierNames,
    }),
  );

  if (!outcome.ok) {
    return NextResponse.json(
      { error: `تعذّرت القراءة: ${outcome.reason}` },
      { status: 502 },
    );
  }

  const x = outcome.value;
  const read = {
    subtotalMinor: parseRiyals(x.subtotalAmount) ?? null,
    vatMinor: parseRiyals(x.vatAmount) ?? null,
    totalMinor: parseRiyals(x.totalAmount) ?? null,
    sellerVat: x.sellerVatNumber?.trim() || null,
    buyerVat: x.buyerVatNumber?.trim() || null,
    lineCount: x.lines.length,
    lines: x.lines.slice(0, 40).map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
  };

  /* ── معاينة: ما قُرئ، ولا شيء يُكتَب ── */
  if (body.apply !== true) {
    return NextResponse.json({
      ok: true,
      applied: false,
      model: outcome.model,
      fileName: doc.fileName,
      read,
      note:
        "هذه قراءةٌ جديدة لم تُكتَب بعد. قارنها بالملفّ ثمّ أقرّها — "
        + "ورقمُ الفاتورة لا يُؤخَذ من النموذج ويبقى كما هو.",
    });
  }

  if (!doc.invoiceId || !doc.supplierId) {
    return NextResponse.json(
      { error: "لا فاتورةَ مقيَّدة لهذا المستند — لا موضعَ تُكتَب فيه القراءة." },
      { status: 409 },
    );
  }

  /* حالُ الضريبة تُعاد اشتقاقها من المقروء — لا تُؤخَذ من المتصفّح ولا من النموذج */
  const review = reviewConfirmed(
    {
      documentKind: doc.kind,
      supplierId: doc.supplierId,
      invoiceNumber: doc.invoiceNumber,
      invoiceDate: doc.invoiceDate ? doc.invoiceDate.toISOString().slice(0, 10) : null,
      subtotalMinor: read.subtotalMinor,
      vatMinor: read.vatMinor,
      totalMinor: read.totalMinor,
      sellerVat: read.sellerVat,
      buyerVat: read.buyerVat,
    },
    {
      companyVat: companyConfig.vatNumber,
      supplierIssuesInvoices: doc.issuesInvoices ?? undefined,
      supplierContractOnFile: doc.contractOnFile ?? undefined,
    },
  );

  let written = 0;
  try {
    await db.transaction(async (t) => {
      if (doc.periodMonth) await assertMonthsOpen(t, [doc.periodMonth]);

      /*
        الإجماليُّ لا يُكتَب من القراءة إن لم يُقرأ: الموجودُ مؤكَّدٌ من
        إنسانٍ وقتَ الأرشفة، والمجهولُ لا يحلّ محلّ المعلوم.
      */
      await t
        .update(invoices)
        .set({
          subtotalMinor: read.subtotalMinor ?? undefined,
          vatMinor: read.vatMinor ?? undefined,
          ...(read.totalMinor !== null ? { totalMinor: read.totalMinor } : {}),
          sellerVat: read.sellerVat ?? undefined,
          buyerVat: read.buyerVat ?? undefined,
          taxStatus: review.taxStatus,
          inputVatStatus: review.inputVatStatus,
        })
        .where(eq(invoices.id, doc.invoiceId!));

      written = await replaceLines(t, {
        invoiceId: doc.invoiceId!,
        supplierId: doc.supplierId!,
        invoiceDate: doc.invoiceDate,
        subtotalMinor: read.subtotalMinor,
        lines: x.lines,
      });
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }

  await recordAudit({
    actorId: user.id,
    action: "DOCUMENT_REREAD",
    entityType: "document",
    entityId: doc.id,
    before: { invoiceId: doc.invoiceId },
    after: { ...read, lines: undefined, linesWritten: written, model: outcome.model, taxStatus: review.taxStatus },
  });

  return NextResponse.json({
    ok: true,
    applied: true,
    linesWritten: written,
    taxStatus: review.taxStatus,
    model: outcome.model,
  });
}
