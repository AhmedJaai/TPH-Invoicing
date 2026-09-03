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
import { accounts, documents, invoiceLines, invoices, payments, statements, issues } from "@/db/schema";
import { isAuthBypassed, requireUser, UnauthenticatedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/permissions";
import { driveConfig } from "@/config/drive";
import { driveForUser, findOrCreateFolder, existingNamesIn, uploadFile } from "@/lib/drive";
import { resolveNameCollision } from "@/lib/naming";
import { parseRiyals } from "@/lib/money";
import { diffCorrections, recordAudit } from "@/lib/audit";
import { normalizeItem } from "@/lib/items";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const blockers = (body.findings ?? []).filter((f) => f.severity === "BLOCKER");
  if (blockers.length > 0) {
    return NextResponse.json(
      { error: `لا يمكن الأرشفة قبل معالجة: ${blockers[0].message}` },
      { status: 409 },
    );
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
  const subtotalMinor = parseRiyals(body.subtotal ?? "") ?? null;
  const vatMinor = parseRiyals(body.vat ?? "") ?? null;
  const totalMinor = parseRiyals(body.total ?? "") ?? null;

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

    const isInvoice = ["TAX_INVOICE", "SIMPLIFIED_INVOICE"].includes(body.documentKind);
    if (isInvoice && body.supplierId && body.invoiceNumber && body.invoiceDate && totalMinor !== null) {
      const [inv] = await tx.insert(invoices).values({
        documentId: doc.id,
        supplierId: body.supplierId,
        invoiceNumber: body.invoiceNumber,
        invoiceDate: new Date(`${body.invoiceDate}T00:00:00Z`),
        periodMonth: body.periodMonth,
        subtotalMinor: subtotalMinor ?? 0,
        vatMinor: vatMinor ?? 0,
        totalMinor,
        sellerVat: body.sellerVat ?? null,
        buyerVat: body.buyerVat ?? null,
        isTaxValid: body.isTaxValid ?? false,
        inputVatEligible: body.inputVatEligible ?? false,
        isFixedAsset: body.isFixedAsset ?? false,
      }).returning({ id: invoices.id });

      // البنود: بلا تخمين — السطر بلا سعر وحدة أو مبلغ لا يُسجَّل،
      // لأنّ صفراً مخترعاً يفسد متوسط السعر وتحليل الاستهلاك معاً.
      for (const l of body.lines ?? []) {
        const description = l.description?.trim();
        if (!description) continue;
        const unitPriceMinor = parseRiyals(l.unitPrice ?? "");
        const lineTotalMinor = parseRiyals(l.lineTotal ?? "");
        if (unitPriceMinor === null && lineTotalMinor === null) continue;

        const quantity = Number((l.quantity ?? "1").replace(/[^\d.]/g, "")) || 1;
        const resolvedTotal = lineTotalMinor ?? Math.round((unitPriceMinor ?? 0) * quantity);
        const resolvedUnit =
          unitPriceMinor ?? (quantity > 0 ? Math.round(resolvedTotal / quantity) : resolvedTotal);

        await tx.insert(invoiceLines).values({
          invoiceId: inv.id,
          description,
          normalizedDescription: normalizeItem(description),
          qty: String(quantity),
          unitPriceMinor: resolvedUnit,
          lineTotalMinor: resolvedTotal,
          invoiceDate: new Date(`${body.invoiceDate}T00:00:00Z`),
          supplierId: body.supplierId,
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

    // التنبيهات غير المانعة تبقى مفتوحة لتُتابَع لا لتُنسى
    for (const f of body.findings ?? []) {
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
