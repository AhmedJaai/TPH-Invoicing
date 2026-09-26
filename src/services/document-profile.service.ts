/**
 * ملفُّ المستند — كلُّ ما يُعرف عن ملفٍّ واحد، وكيف قرّر النظامُ فيه.
 *
 * ── لماذا وُجد ──
 *
 * «الدرايف ← التسمية ← أكمِل الناقص» كان يفتح قائمةَ المستندات مصفّاةً
 * باسم الملفّ، ولا شيء فيها يُكمَل: لا يُقال ما نقص، ولا حقلٌ يُكتب فيه،
 * ولا سبيلَ إلى رفضه، ولا شرحٌ لما رآه النموذج. وثلاثةُ مستنداتٍ في الإنتاج
 * كانت هكذا: فاتورةٌ بلا تاريخ، ومبسّطةٌ مورّدُها غير مسجَّل، وعرضُ سعر.
 * فصار لكلّ مستندٍ ملفٌّ يجيب بالترتيب: ما هو؟ ← ما الذي يمنعه؟ ← كيف
 * قرّر النظام؟ ← ماذا أفعل به؟
 *
 * **والشرحُ من الدوالّ التي قرّرت** (`autoArchive` · `canonicalName` ·
 * `missingFromReading`) لا نصٌّ يُكتب ثانيةً — فلا يفترق القرارُ عن تفسيره.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, documents, invoices, statements, suppliers, users } from "@/db/schema";
import { autoArchive, sumLineTotals, type AutoArchiveVerdict } from "@/lib/extraction/auto-archive";
import { canonicalName, type NameVerdict } from "@/lib/canonical-name";
import { factsFromFileName } from "@/lib/extraction/filename-facts";
import { normalizeDocumentDate } from "@/lib/document-date";
import { formatRiyals, parseRiyals } from "@/lib/money";
import { matchSupplier } from "@/lib/supplier-match";
import { loadSuppliers, missingFromReading, supplierByVatInName, type StoredReading } from "@/services/document-backlog.service";
import { loadNamedDocuments } from "@/services/drive-status.service";

export interface DocumentProfile {
  id: string;
  fileName: string;
  mimeType: string;
  driveFileId: string | null;
  kind: string;
  status: "PENDING" | "EXTRACTED" | "NEEDS_REVIEW" | "ARCHIVED" | "REJECTED";
  periodMonth: string | null;
  uploadedAt: Date;
  uploadedBy: string | null;
  textSource: string | null;
  model: string | null;
  confidence: Record<string, number> | null;
  supplier: { id: string; nameAr: string; slug: string } | null;
  invoice: { id: string; number: string; totalMinor: number } | null;
  statementId: string | null;
  /** ما قرأه النموذج — كما حُفظ، لا يُعدَّل. */
  reading: {
    kind: string | null;
    supplierName: string | null;
    sellerVat: string | null;
    buyerVat: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    subtotal: string | null;
    vat: string | null;
    total: string | null;
    lineCount: number;
  } | null;
  /** ما يُقترح لإكمال القيد — من القراءة ثمّ من اسم الملفّ، ولكلٍّ مصدرُه. */
  proposal: {
    kind: string;
    supplierId: string | null;
    supplierHow: "document" | "reading" | "vat-in-name" | null;
    invoiceNumber: string;
    invoiceDate: string;
    subtotal: string;
    vat: string;
    total: string;
    sellerVat: string;
    buyerVat: string;
    fromName: string[];
  };
  /** فاتورةٌ مقيَّدةٌ لمورّده برقمه المقروء — فالمستندُ نسخةٌ منها يُرفض لا يُقيَّد. */
  twin: { id: string; number: string } | null;
  /** ما يمنع القيد بعينه — `missingFromReading`، وفارغٌ لما قُيِّد. */
  missing: string[];
  verdict: AutoArchiveVerdict;
  /** حكمُ الاسم القياسيّ — `null` لما لا ملفَّ له في الدرايف أو رُفض. */
  name: NameVerdict | null;
  history: { id: string; action: string; at: Date; actor: string | null; after: unknown }[];
}

const INVOICE_KINDS = new Set(["TAX_INVOICE", "SIMPLIFIED_INVOICE"]);

export async function loadDocumentProfile(id: string): Promise<DocumentProfile | null> {
  const [row] = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      driveFileId: documents.driveFileId,
      kind: documents.kind,
      status: documents.status,
      periodMonth: documents.periodMonth,
      uploadedAt: documents.uploadedAt,
      uploadedBy: users.name,
      textSource: documents.textSource,
      model: documents.extractionModel,
      confidence: documents.fieldConfidence,
      reading: documents.extractionJson,
      supplierId: suppliers.id,
      supplierName: suppliers.nameAr,
      supplierSlug: suppliers.slug,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      subtotalMinor: invoices.subtotalMinor,
      vatMinor: invoices.vatMinor,
      totalMinor: invoices.totalMinor,
      statementId: statements.id,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedById))
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .leftJoin(statements, eq(statements.documentId, documents.id))
    .where(eq(documents.id, id))
    .limit(1);
  if (!row) return null;

  const x = (row.reading ?? null) as StoredReading | null;
  const fromName = factsFromFileName(row.fileName);
  const readKind = x?.documentKind ?? null;
  const kind = row.kind === "UNKNOWN" && readKind ? readKind : row.kind;

  /* المورّد: المقيَّد على المستند، ثمّ ما يطابق القراءة، ثمّ رقمٌ ضريبيٌّ في اسم الملفّ */
  let supplierId = row.supplierId;
  let supplierHow: DocumentProfile["proposal"]["supplierHow"] = supplierId ? "document" : null;
  if (!supplierId) {
    const list = await loadSuppliers();
    const byReading = x ? matchSupplier(list, {
      sellerVatNumber: x.sellerVatNumber,
      supplierNameAr: x.supplierNameAr,
      supplierNameEn: x.supplierNameEn,
    }).supplier : undefined;
    const byName = byReading ? undefined : supplierByVatInName(list, row.fileName);
    supplierId = byReading?.id ?? byName?.id ?? null;
    supplierHow = byReading ? "reading" : byName ? "vat-in-name" : null;
  }

  const readNumber = x?.invoiceNumber?.trim() || null;
  const readDate = normalizeDocumentDate(x?.invoiceDate) ?? null;
  const readTotal = x?.totalAmount?.trim() || null;
  const fromNameUsed: string[] = [];
  if (!readNumber && fromName.invoiceNumber) fromNameUsed.push("رقم الفاتورة");
  if (!readDate && fromName.date) fromNameUsed.push("التاريخ");
  if (!readTotal && fromName.totalMinor !== null) fromNameUsed.push("الإجماليّ");

  const recorded = row.invoiceId !== null || row.statementId !== null;
  const totalForMissing = parseRiyals(readTotal ?? "") ?? fromName.totalMinor;
  const missing = recorded || !INVOICE_KINDS.has(kind)
    ? []
    : missingFromReading({
        supplierKnown: supplierId !== null,
        invoiceNumber: readNumber ?? fromName.invoiceNumber,
        invoiceDate: readDate ?? fromName.date,
        totalMinor: totalForMissing,
        rawDate: x?.invoiceDate?.trim() || null,
      });

  const verdict = autoArchive({
    kind,
    invoiceRecorded: row.invoiceId !== null,
    statementRecorded: row.statementId !== null,
    textSource: row.textSource,
    supplierKnown: row.supplierId !== null,
    subtotalMinor: row.subtotalMinor,
    vatMinor: row.vatMinor,
    totalMinor: row.totalMinor,
    invoiceNumber: row.invoiceNumber,
    fileName: row.fileName,
    linesTotalMinor: sumLineTotals(x?.lines, (v) => parseRiyals(v)),
  });

  const twinNumber = readNumber ?? fromName.invoiceNumber;
  const [twinRow] = !recorded && supplierId && twinNumber
    ? await db.select({ id: invoices.id, number: invoices.invoiceNumber }).from(invoices)
        .where(and(eq(invoices.supplierId, supplierId), eq(invoices.invoiceNumber, twinNumber))).limit(1)
    : [];

  /* الاسمُ من المصدر الواحد لشاشة التسمية — فلا يقول الملفُّ غيرَ ما تقوله */
  const named = row.driveFileId ? (await loadNamedDocuments()).find((d) => d.documentId === id) : undefined;
  const name = named ? canonicalName(named) : null;

  const history = await db
    .select({ id: auditLogs.id, action: auditLogs.action, at: auditLogs.at, actor: users.name, after: auditLogs.after })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(eq(auditLogs.entityType, "document"), eq(auditLogs.entityId, id)))
    .orderBy(desc(auditLogs.at))
    .limit(20);

  /* الهللاتُ نصّاً بلا عددٍ عشريّ — `formatRiyals` كما في كلّ حقلٍ يُعاد إرسالُه */
  const minorText = (m: number | null | undefined) => (m === null || m === undefined ? "" : formatRiyals(m));

  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    driveFileId: row.driveFileId,
    kind,
    status: row.status,
    periodMonth: row.periodMonth,
    uploadedAt: row.uploadedAt,
    uploadedBy: row.uploadedBy,
    textSource: row.textSource,
    model: row.model,
    confidence: (row.confidence ?? null) as Record<string, number> | null,
    supplier: row.supplierId && row.supplierName && row.supplierSlug
      ? { id: row.supplierId, nameAr: row.supplierName, slug: row.supplierSlug }
      : null,
    invoice: row.invoiceId && row.totalMinor !== null
      ? { id: row.invoiceId, number: row.invoiceNumber ?? "", totalMinor: row.totalMinor }
      : null,
    statementId: row.statementId,
    reading: x
      ? {
          kind: readKind,
          supplierName: x.supplierNameAr || x.supplierNameEn || null,
          sellerVat: x.sellerVatNumber || null,
          buyerVat: x.buyerVatNumber || null,
          invoiceNumber: readNumber,
          invoiceDate: x.invoiceDate?.trim() || null,
          subtotal: x.subtotalAmount?.trim() || null,
          vat: x.vatAmount?.trim() || null,
          total: readTotal,
          lineCount: x.lines?.length ?? 0,
        }
      : null,
    proposal: {
      kind: INVOICE_KINDS.has(kind) ? kind : "TAX_INVOICE",
      supplierId,
      supplierHow,
      invoiceNumber: readNumber ?? fromName.invoiceNumber ?? "",
      invoiceDate: readDate ?? fromName.date ?? "",
      subtotal: x?.subtotalAmount?.trim() || "",
      vat: x?.vatAmount?.trim() || "",
      total: readTotal ?? minorText(fromName.totalMinor),
      sellerVat: x?.sellerVatNumber || "",
      buyerVat: x?.buyerVatNumber || "",
      fromName: fromNameUsed,
    },
    twin: twinRow ? { id: twinRow.id, number: twinRow.number } : null,
    missing,
    verdict,
    name,
    history,
  };
}
