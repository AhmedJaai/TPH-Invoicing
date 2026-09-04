/**
 * الأرشفة: يرفع الملف إلى الدرايف بصلاحية المستخدم نفسه، ويسجّله في قاعدة
 * البيانات، ويكتب في سجل التدقيق ما استُخرج آلياً وما عدّله الإنسان.
 *
 * لا يُستدعى إلا بعد تأكيد بشري صريح في شاشة المعاينة.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents, invoiceLines, invoices, monthCloses, payments, statements, issues, suppliers } from "@/db/schema";
import { isAuthBypassed, requireUser, UnauthenticatedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/permissions";
import { driveConfig } from "@/config/drive";
import { driveForUser, findOrCreateFolder, existingNamesIn, uploadFile } from "@/lib/drive";
import { resolveNameCollision } from "@/lib/naming";
import { parseRiyals } from "@/lib/money";
import { diffCorrections, recordAudit } from "@/lib/audit";
import { normalizeItem } from "@/lib/items";
import { reconcileInvoiceLines, resolveLinePricing } from "@/lib/line-pricing";
import { reviewConfirmed } from "@/lib/confirm";
import { companyConfig } from "@/config/drive";

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
  /**
   * رايات المتصفّح — تُقرأ ولا يُعمل بها.
   * الخادم يعيد حسابها من القيم المعتمدة، فلا يقرّر المتصفّح صحّة فاتورة ضريبياً.
   */
  isTaxValid?: boolean;
  inputVatEligible?: boolean;
  isFixedAsset?: boolean;
  /** ما استخرجه النموذج قبل أي تعديل، للمقارنة والتدقيق */
  rawExtraction?: Record<string, unknown>;
  extractionModel?: string;
  findings?: { code: string; severity: "INFO" | "WARN" | "BLOCKER"; message: string }[];
  /** بنود الفاتورة كما استُخرجت — عليها يقوم تتبّع الأسعار وتحليل الاستهلاك */
  lines?: { description: string; quantity: string; unitPrice: string; lineTotal: string }[];
}

const MONTH_RE = /^\d{4}-\d{2}$/;

/** refresh token الخاص بالمستخدم — الرفع بصلاحيته هو ما يجعل سجل الدرايف صادقاً. */
async function driveTokenFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ token: accounts.refresh_token })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  return row?.token ?? null;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("document:upload");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  let body: ArchiveBody;
  try {
    body = (await request.json()) as ArchiveBody;
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  if (!body.fileName || !body.folderName || !MONTH_RE.test(body.periodMonth ?? "")) {
    return NextResponse.json({ error: "الاسم أو المجلد أو الشهر ناقص" }, { status: 400 });
  }

  let data: Buffer;
  try {
    data = Buffer.from(body.fileBase64, "base64");
  } catch {
    return NextResponse.json({ error: "محتوى الملف غير صالح" }, { status: 400 });
  }
  if (data.length === 0) return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });

  const sha256 = createHash("sha256").update(data).digest("hex");

  const [duplicate] = await db
    .select({ id: documents.id, fileName: documents.fileName })
    .from(documents)
    .where(eq(documents.sha256, sha256))
    .limit(1);
  if (duplicate) {
    return NextResponse.json(
      { error: `هذا الملف مرفوع مسبقاً باسم ${duplicate.fileName}` },
      { status: 409 },
    );
  }

  /*
   * الشهر المقفل مقفل فعلاً.
   * إقفالٌ يمكن أن يُضاف إليه بعده ليس إقفالاً، والتقارير التي بُنيت عليه
   * تصير كاذبة بأثر رجعي. من وجد فاتورة متأخّرة يعيد فتح الشهر عمداً.
   */
  const [closed] = await db
    .select({ status: monthCloses.status })
    .from(monthCloses)
    .where(eq(monthCloses.month, body.periodMonth))
    .limit(1);

  if (closed?.status === "CLOSED") {
    return NextResponse.json(
      { error: `شهر ${body.periodMonth} مقفل. أعد فتحه من صفحة الإقفال إن كانت هذه فاتورة متأخّرة.` },
      { status: 409 },
    );
  }

  // ── التحقّق على الخادم ──
  // يُعاد الحساب هنا من القيم المعتمدة. رايات المتصفّح لا تُصدَّق.
  const subtotalMinor = parseRiyals(body.subtotal ?? "");
  const vatMinor = parseRiyals(body.vat ?? "");
  const totalMinor = parseRiyals(body.total ?? "");

  const [supplierRow] = body.supplierId
    ? await db
        .select({
          id: suppliers.id,
          issuesInvoices: suppliers.issuesInvoices,
          contractOnFile: suppliers.contractOnFile,
        })
        .from(suppliers)
        .where(eq(suppliers.id, body.supplierId))
        .limit(1)
    : [];

  if (body.supplierId && !supplierRow) {
    return NextResponse.json({ error: "المورد المحدَّد غير موجود" }, { status: 400 });
  }

  const trimmedNumber = body.invoiceNumber?.trim();
  const duplicateInvoiceNumber =
    Boolean(body.supplierId && trimmedNumber) &&
    (
      await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.supplierId, body.supplierId!), eq(invoices.invoiceNumber, trimmedNumber!)))
        .limit(1)
    ).length > 0;

  const review = reviewConfirmed(
    {
      documentKind: body.documentKind,
      supplierId: body.supplierId,
      invoiceNumber: body.invoiceNumber,
      invoiceDate: body.invoiceDate,
      subtotalMinor,
      vatMinor,
      totalMinor,
      sellerVat: body.sellerVat,
      buyerVat: body.buyerVat,
    },
    {
      companyVat: companyConfig.vatNumber,
      supplierIssuesInvoices: supplierRow?.issuesInvoices,
      supplierContractOnFile: supplierRow?.contractOnFile,
      duplicateFile: false, // فُحصت بالبصمة أعلاه وردّت 409
      duplicateInvoiceNumber,
    },
  );

  if (review.blockers.length > 0) {
    return NextResponse.json(
      {
        error: `لا يمكن الأرشفة قبل معالجة: ${review.blockers[0].message}`,
        blockers: review.blockers.map((f) => f.message),
      },
      { status: 409 },
    );
  }

  const token = await driveTokenFor(user.id);
  if (!token) {
    return NextResponse.json(
      {
        error: isAuthBypassed()
          ? "وضع التجربة لا يرفع إلى الدرايف — الرفع يحتاج حساب جوجل حقيقياً. التحليل والقراءة يعملان."
          : "لا يوجد تفويض درايف لحسابك. سجّل الخروج ثم الدخول مرة أخرى ووافق على صلاحية الدرايف.",
      },
      { status: 428 },
    );
  }

  // ── الدرايف ──
  const year = body.periodMonth.slice(0, 4);
  const yearFolderId = driveConfig.yearFolderIds[year];
  if (!yearFolderId) {
    return NextResponse.json({ error: `لا يوجد مجلد لسنة ${year} في الإعدادات` }, { status: 400 });
  }

  const drive = driveForUser(token);
  let folderId: string;
  let finalName: string;
  let uploaded;

  try {
    const monthFolderId = await findOrCreateFolder(drive, yearFolderId, body.periodMonth);
    folderId = await findOrCreateFolder(drive, monthFolderId, body.folderName);
    const taken = await existingNamesIn(drive, folderId);
    finalName = resolveNameCollision(body.fileName, taken);
    uploaded = await uploadFile(drive, {
      folderId,
      fileName: finalName,
      mimeType: body.mimeType || "application/pdf",
      data,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `تعذّر الرفع إلى الدرايف: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  // ── قاعدة البيانات ──
  const kindMap: Record<string, string> = {
    TAX_INVOICE: "TAX_INVOICE", SIMPLIFIED_INVOICE: "SIMPLIFIED_INVOICE",
    STATEMENT: "STATEMENT", QUOTATION: "QUOTATION", PROFORMA: "PROFORMA",
    RECEIPT: "RECEIPT", CASH_RECEIPT: "CASH_RECEIPT", CONTRACT: "CONTRACT",
    UTILITY: "UTILITY",
  };

  const documentId = await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        driveFileId: uploaded.fileId,
        driveFolderId: folderId,
        fileName: finalName,
        mimeType: body.mimeType || "application/pdf",
        sizeBytes: data.length,
        sha256,
        kind: (kindMap[body.documentKind] ?? "UNKNOWN") as never,
        status: "ARCHIVED",
        periodMonth: body.periodMonth,
        supplierId: body.supplierId ?? null,
        extractionJson: (body.rawExtraction ?? null) as never,
        extractionModel: body.extractionModel ?? null,
        uploadedById: user.id,
      })
      .returning({ id: documents.id });

    // الشروط فُحصت على الخادم قبل الرفع؛ ما وصل هنا مكتمل أو ليس فاتورة
    if (review.canCreateInvoice) {
      const [inv] = await tx.insert(invoices).values({
        documentId: doc.id,
        supplierId: body.supplierId!,
        invoiceNumber: trimmedNumber!,
        invoiceDate: new Date(`${body.invoiceDate}T00:00:00Z`),
        periodMonth: body.periodMonth,
        subtotalMinor: subtotalMinor ?? 0,
        vatMinor: vatMinor ?? 0,
        totalMinor: totalMinor!,
        sellerVat: body.sellerVat ?? null,
        buyerVat: body.buyerVat ?? null,
        // من الخادم لا من المتصفّح
        isTaxValid: review.isTaxValid,
        inputVatEligible: review.inputVatEligible,
        isFixedAsset: review.isFixedAsset,
      }).returning({ id: invoices.id });

      // البنود: بلا تخمين — السطر بلا سعر وحدة أو مبلغ لا يُسجَّل،
      // لأنّ صفراً مخترعاً يفسد متوسط السعر وتحليل الاستهلاك معاً.
      const resolved: (ReturnType<typeof resolveLinePricing> & object & {
        description: string; quantity: number;
      })[] = [];

      for (const l of body.lines ?? []) {
        const description = l.description?.trim();
        if (!description) continue;
        const quantity = Number((l.quantity ?? "1").replace(/[^\d.]/g, "")) || 1;
        // السعر الفعلي لا سعر القائمة — راجع lib/line-pricing.ts
        const pricing = resolveLinePricing({
          quantity,
          unitPriceMinor: parseRiyals(l.unitPrice ?? ""),
          lineTotalMinor: parseRiyals(l.lineTotal ?? ""),
        });
        if (!pricing) continue;
        resolved.push({ ...pricing, description, quantity });
      }

      // ثمّ تُسوّى البنود بصافي الفاتورة: بعض المورّدين يكتبها شاملة الضريبة
      const { lines: finalLines } = reconcileInvoiceLines(resolved, subtotalMinor);

      for (const l of finalLines) {
        await tx.insert(invoiceLines).values({
          invoiceId: inv.id,
          description: l.description,
          normalizedDescription: normalizeItem(l.description),
          qty: String(l.quantity),
          unitPriceMinor: l.effectiveUnitMinor,
          lineTotalMinor: l.netTotalMinor,
          listUnitPriceMinor: l.listUnitMinor,
          discountMinor: l.discountMinor,
          pricingBasis: l.basis,
          invoiceDate: new Date(`${body.invoiceDate}T00:00:00Z`),
          supplierId: body.supplierId!,
        });
      }
    }

    if (body.documentKind === "STATEMENT" && body.supplierId && body.invoiceDate) {
      const end = new Date(`${body.invoiceDate}T00:00:00Z`);
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      await tx.insert(statements).values({
        documentId: doc.id,
        supplierId: body.supplierId,
        periodStart: start,
        periodEnd: end,
        closingBalanceMinor: totalMinor ?? 0,
      });
    }

    if (["RECEIPT", "CASH_RECEIPT"].includes(body.documentKind) && body.invoiceDate && totalMinor !== null) {
      await tx.insert(payments).values({
        documentId: doc.id,
        supplierId: body.supplierId ?? null,
        paidAt: new Date(`${body.invoiceDate}T00:00:00Z`),
        amountMinor: totalMinor,
        method: body.documentKind === "CASH_RECEIPT" ? "CASH" : "BANK_TRANSFER",
        beneficiaryNameRaw: body.beneficiary ?? null,
        appliesToMonth: body.periodMonth,
      });
    }

    // التنبيهات غير المانعة تبقى مفتوحة لتُتابَع لا لتُنسى.
    // مصدرها الخادم؛ ويُضاف من المتصفّح ما لا يستطيع الخادم حسابه وحده:
    // ثقة النموذج في كل حقل، وهي معلومة لا مانعة.
    const persisted = [
      ...review.findings,
      ...(body.findings ?? []).filter((f) => f.code === "LOW_CONFIDENCE_FIELD"),
    ];
    for (const f of persisted) {
      await tx.insert(issues).values({
        code: f.code,
        severity: f.severity,
        entityType: "document",
        entityId: doc.id,
        message: f.message,
      });
    }

    return doc.id;
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
      fileName: finalName,
      driveFileId: uploaded.fileId,
      folderName: body.folderName,
      periodMonth: body.periodMonth,
      manualCorrections: corrections,
    },
  });

  return NextResponse.json({
    ok: true,
    documentId,
    fileName: finalName,
    renamed: finalName !== body.fileName,
    driveFileId: uploaded.fileId,
    webViewLink: uploaded.webViewLink,
    correctedFields: Object.keys(corrections),
  });
}
