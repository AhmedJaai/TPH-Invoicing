/**
 * ما تراكم قبل أن تستقيم القراءة — يُعالَج من غير أن يُعاد النداء.
 *
 * قال أحمد (٢٤ سبتمبر ٢٠٢٦): «فواتير كثير كاتب لا تاريخ مقيَّد وهو يوجد
 * تاريخ بالفاتورة». والتاريخُ كان مقروءاً فعلاً ومحفوظاً في
 * `documents.extraction_json` — لكنّ القيد يطلب `YYYY-MM-DD` حرفاً بحرف،
 * والنموذجُ أعاد «13/09/2026»، فرُمي التاريخ ولم تُقيَّد الفاتورة. فلا
 * حاجة إلى نداءٍ مدفوعٍ ثانٍ: يُقرأ المحفوظ بالتوحيد الجديد، وتُقيَّد
 * الفاتورةُ بالمسار نفسه الذي تمرّ به المزامنة (`createInvoice` ثمّ
 * `replaceLines` ثمّ خصمُ رصيد المورّد).
 *
 * وما لم يُقيَّد بعدها يُقال ما نقصه **بعينه** — لا «ينقصه ركن».
 */

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, statements, supplierAliases, suppliers } from "@/db/schema";
import { reviewConfirmed } from "@/lib/confirm";
import { normalizeDocumentDate } from "@/lib/document-date";
import { parseRiyals } from "@/lib/money";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import { companyConfig } from "@/config/drive";
import { createInvoice, createStatement, replaceLines } from "@/services/invoice.service";
import { parseStatementExtras } from "@/lib/extraction/statement-extras";
import { factsFromFileName } from "@/lib/extraction/filename-facts";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { recordAudit } from "@/lib/audit";
import { MonthClosedError } from "@/services/validation.service";
import { findInvoiceTwin, twinReason, type RecordedInvoice } from "@/lib/invoice-twin";

export interface StoredReading {
  documentKind?: string;
  supplierNameAr?: string;
  supplierNameEn?: string;
  sellerVatNumber?: string;
  buyerVatNumber?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  subtotalAmount?: string;
  vatAmount?: string;
  totalAmount?: string;
  lines?: { description?: string; quantity?: string; unitPrice?: string; lineTotal?: string }[];
}

const INVOICE_KINDS = new Set(["TAX_INVOICE", "SIMPLIFIED_INVOICE"]);

/** المورّدون القائمون بأسمائهم البديلة — للمطابقة بالقراءة. يقرؤه قيدُ المستند باليد أيضاً. */
export async function loadSuppliers(): Promise<SupplierRecord[]> {
  const rows = await db.select({
    id: suppliers.id, slug: suppliers.slug, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn,
    driveFolderName: suppliers.driveFolderName, vatNumber: suppliers.vatNumber,
    issuesInvoices: suppliers.issuesInvoices, contractOnFile: suppliers.contractOnFile,
  }).from(suppliers).where(eq(suppliers.isActive, true));
  const aliasRows = rows.length
    ? await db.select({ supplierId: supplierAliases.supplierId, normalized: supplierAliases.normalized })
        .from(supplierAliases).where(inArray(supplierAliases.supplierId, rows.map((r) => r.id)))
    : [];
  return rows.map((r) => ({
    ...r,
    aliases: aliasRows.filter((a) => a.supplierId === r.id).map((a) => ({ normalized: a.normalized })),
  }));
}

export function supplierByVatInName(list: readonly SupplierRecord[], fileName: string): SupplierRecord | undefined {
  const vat = fileName.match(/(?:^|\D)(3\d{13}3)(?:\D|$)/)?.[1];
  if (!vat) return undefined;
  return list.find((s) => (s.vatNumber ?? "").replace(/\D/g, "") === vat);
}

/** آخرُ يومٍ من «YYYY-MM» — بالتقويم لا بالحدس. */
function lastDayOf(month: string): string | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2], 0));
  return d.toISOString().slice(0, 10);
}

/** ما نقص بعينه — الجملةُ التي تُقال تحت المستند. */
export function missingFromReading(r: {
  supplierKnown: boolean; invoiceNumber: string | null; invoiceDate: string | null; totalMinor: number | null;
  rawDate: string | null;
}): string[] {
  const out: string[] = [];
  if (!r.supplierKnown) out.push("المورّد: لم يُعرَف من الاسم المقروء");
  if (!r.invoiceNumber) out.push("رقم الفاتورة: لم يُقرأ");
  if (!r.invoiceDate) {
    out.push(r.rawDate ? `التاريخ: قُرئ «${r.rawDate}» ولم يُفهَم` : "التاريخ: لم يُقرأ");
  }
  if (r.totalMinor === null) out.push("الإجمالي: لم يُقرأ");
  return out;
}


/** ما يُقيَّد — أو ما سيُقيَّد في المعاينة — بما يكفي ليُقال بجملة. */
export interface BacklogItem {
  documentId: string;
  fileName: string;
  kind: "INVOICE" | "STATEMENT";
  supplierName: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  totalMinor: number | null;
  /** أُرشف من قبل بلا قيد — فخصمُ رصيد المورّد يقع الآن. */
  wasArchived: boolean;
}

export interface BacklogOutcome {
  recorded: number;
  /** ما قُيِّد، أو ما سيُقيَّد في المعاينة. */
  items: BacklogItem[];
  missing: { documentId: string; fileName: string; reasons: string[] }[];
}

/**
 * يقيّد فاتورةً (أو كشفاً) لكلّ مستندٍ لا قيدَ له، من قراءته المحفوظة —
 * ما ينتظر المراجعة **وما أُرشف** كذلك.
 *
 * وكان المؤرشَفُ خارجه: ثماني فواتير في الإنتاج أُرشفت ولم تُقيَّد، فلا
 * تدخل «كم أدين» وتبقى دفعاتُها «رصيداً لك». قال أحمد (٢٦ سبتمبر ٢٠٢٦):
 * «المفترض يبحث في الأرشيف ويتأكّد إذا مكرّرة أو لا، وإذا لم يجد أيّ
 * مشكلة يقيّدها». فيُقيَّد بشروطٍ كلّها:
 *   - نوعُه فاتورة: ما صنّفه إنسانٌ يحكم، ثمّ ما قرأه النموذج؛
 *   - مورّدُه مسجَّلٌ ومعروفٌ بالمستند أو بالرقم الضريبيّ أو بالاسم؛
 *   - الرقمُ والتاريخُ والإجماليُّ مقروءة، و`reviewConfirmed` بلا مانع
 *     (ومنه: الرقمُ الضريبيّ للمشتري ليس رقمَنا — فليست فاتورتَنا)؛
 *   - **ولا توأمَ لها** بين المقيَّد: الرقمُ نفسه بأيّ صيغة، أو اليومُ
 *     والمبلغ نفسهما (`findInvoiceTwin`) — فتُترك للإنسان من ملفّها.
 *
 * و`dryRun` يقول ما سيقع ولا يكتب — لزرّ «راجِع الحسابات» قبل التنفيذ.
 */
export async function recordFromStoredReadings(
  actorId: string,
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<BacklogOutcome> {
  const limit = options.limit ?? 60;
  const dryRun = options.dryRun ?? false;
  const pending = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      status: documents.status,
      kind: documents.kind,
      supplierId: documents.supplierId,
      periodMonth: documents.periodMonth,
      reading: documents.extractionJson,
    })
    .from(documents)
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .leftJoin(statements, eq(statements.documentId, documents.id))
    .where(and(
      inArray(documents.status, ["PENDING", "NEEDS_REVIEW", "ARCHIVED"]),
      isNotNull(documents.extractionJson),
      isNull(invoices.id),
      isNull(statements.id),
    ))
    .orderBy(documents.uploadedAt)
    .limit(limit);

  const out: BacklogOutcome = { recorded: 0, items: [], missing: [] };
  if (pending.length === 0) return out;

  const supplierList = await loadSuppliers();
  const byId = new Map(supplierList.map((s) => [s.id, s]));
  /* المقيَّدُ كلُّه — ويُضاف إليه ما يُقيَّد في هذه الدورة، فلا تُقيَّد نسختان معاً */
  const recordedInvoices: RecordedInvoice[] = (await db
    .select({
      id: invoices.id, supplierId: invoices.supplierId, invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate, totalMinor: invoices.totalMinor,
    })
    .from(invoices))
    .filter((r): r is typeof r & { supplierId: string } => r.supplierId !== null)
    .map((r) => ({
      id: r.id, supplierId: r.supplierId, invoiceNumber: r.invoiceNumber ?? "",
      invoiceDate: r.invoiceDate ? r.invoiceDate.toISOString().slice(0, 10) : null, totalMinor: r.totalMinor,
    }));

  for (const doc of pending) {
    const x = (doc.reading ?? {}) as StoredReading;
    /* ما صنّفه إنسانٌ (أو المزامنةُ من المجلّد) يحكم، ثمّ ما قرأه النموذج */
    const kind = doc.kind && doc.kind !== "UNKNOWN" ? doc.kind : x.documentKind ?? "";
    if (!INVOICE_KINDS.has(kind) && kind !== "STATEMENT") continue;
    /* ما سكت عنه النموذجُ ونطق به اسمُ الملفّ — سدٌّ لفراغ لا تصحيحٌ لقراءة */
    const fromName = factsFromFileName(doc.fileName);

    const supplier = (doc.supplierId ? byId.get(doc.supplierId) : undefined)
      ?? matchSupplier(supplierList, {
        sellerVatNumber: x.sellerVatNumber,
        supplierNameAr: x.supplierNameAr,
        supplierNameEn: x.supplierNameEn,
      }).supplier
      /* رقمٌ ضريبيّ في أوّل اسم الملفّ — «310660311700003_…» — لمورّدٍ مسجَّلٍ به */
      ?? supplierByVatInName(supplierList, doc.fileName)
      ?? undefined;
    const date = normalizeDocumentDate(x.invoiceDate) ?? fromName.date;
    const number = x.invoiceNumber?.trim() || fromName.invoiceNumber;
    const totalMinor = parseRiyals(x.totalAmount ?? "") ?? fromName.totalMinor;
    const wasArchived = doc.status === "ARCHIVED";

    /*
      ── الكشف ── هويّتُه مورّدُه وفترتُه، لا رقمٌ ولا إجماليّ. وتاريخُه إن
      لم يُقرأ فآخرُ يومٍ من شهر مجلّده (كتبه إنسان) — فالكشفُ لا يُحجَز
      بسؤالٍ لا يعنيه.
    */
    if (kind === "STATEMENT") {
      if (!supplier) {
        out.missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: ["المورّد: لم يُعرَف من الاسم المقروء"] });
        continue;
      }
      const end = date ?? (doc.periodMonth ? lastDayOf(doc.periodMonth) : null);
      if (!end) {
        out.missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: ["التاريخ: لم يُقرأ، ولا شهرَ للمجلّد"] });
        continue;
      }
      const item: BacklogItem = {
        documentId: doc.id, fileName: doc.fileName, kind: "STATEMENT", supplierName: supplier.nameAr,
        invoiceNumber: null, invoiceDate: end, totalMinor, wasArchived,
      };
      if (dryRun) {
        out.items.push(item);
        continue;
      }
      try {
        await db.transaction(async (tx) => {
          const parsed = parseStatementExtras(doc.reading);
          await createStatement(tx, {
            documentId: doc.id,
            supplierId: supplier.id,
            periodEnd: new Date(`${end}T00:00:00Z`),
            openingBalanceMinor: parsed.openingBalanceMinor,
            closingBalanceMinor: totalMinor ?? parsed.closingBalanceMinor,
            lines: parsed.lines,
          });
          if (!doc.supplierId) {
            await tx.update(documents).set({ supplierId: supplier.id }).where(eq(documents.id, doc.id));
          }
          await recordAudit({
            actorId,
            action: "DOCUMENT_REREAD",
            entityType: "document",
            entityId: doc.id,
            after: { الملف: doc.fileName, السبب: "قُيِّد كشفاً من القراءة المحفوظة", نهاية_الفترة: end },
          }, tx);
        });
        out.recorded++;
        out.items.push(item);
      } catch (e) {
        if (!(e instanceof MonthClosedError)) throw e;
        out.missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: [e.message] });
      }
      continue;
    }

    const subtotalMinor = parseRiyals(x.subtotalAmount ?? "");
    const vatMinor = parseRiyals(x.vatAmount ?? "");
    const review = reviewConfirmed(
      {
        documentKind: kind,
        supplierId: supplier?.id,
        invoiceNumber: number,
        invoiceDate: date,
        subtotalMinor,
        vatMinor,
        totalMinor,
        sellerVat: x.sellerVatNumber,
        buyerVat: x.buyerVatNumber,
      },
      {
        companyVat: companyConfig.vatNumber,
        supplierIssuesInvoices: supplier?.issuesInvoices,
        supplierContractOnFile: supplier?.contractOnFile,
      },
    );

    if (!review.canCreateInvoice || !supplier || !date || totalMinor === null || !number) {
      out.missing.push({
        documentId: doc.id,
        fileName: doc.fileName,
        reasons: missingFromReading({
          supplierKnown: Boolean(supplier), invoiceNumber: number, invoiceDate: date, totalMinor,
          rawDate: x.invoiceDate?.trim() || null,
        }),
      });
      continue;
    }
    if (review.blockers.length > 0) {
      out.missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: review.blockers.map((b) => b.message) });
      continue;
    }
    const twin = findInvoiceTwin(recordedInvoices, { supplierId: supplier.id, invoiceNumber: number, invoiceDate: date, totalMinor });
    if (twin) {
      out.missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: [twinReason(twin)] });
      continue;
    }

    const invoiceKind: "TAX_INVOICE" | "SIMPLIFIED_INVOICE" = kind === "SIMPLIFIED_INVOICE" ? "SIMPLIFIED_INVOICE" : "TAX_INVOICE";
    const item: BacklogItem = {
      documentId: doc.id, fileName: doc.fileName, kind: "INVOICE", supplierName: supplier.nameAr,
      invoiceNumber: number, invoiceDate: date, totalMinor, wasArchived,
    };
    if (dryRun) {
      out.items.push(item);
      recordedInvoices.push({ id: `planned:${doc.id}`, supplierId: supplier.id, invoiceNumber: number, invoiceDate: date, totalMinor });
      continue;
    }

    try {
      const invoiceId = await db.transaction(async (tx) => {
        const invoiceDate = new Date(`${date}T00:00:00Z`);
        const id = await createInvoice(tx, {
          documentId: doc.id,
          supplierId: supplier.id,
          invoiceNumber: number,
          invoiceDate,
          periodMonth: doc.periodMonth || date.slice(0, 7),
          subtotalMinor,
          vatMinor,
          totalMinor,
          sellerVat: x.sellerVatNumber || null,
          buyerVat: x.buyerVatNumber || null,
          taxStatus: review.taxStatus,
          inputVatStatus: review.inputVatStatus,
          isFixedAsset: review.isFixedAsset,
        });
        if (!id) return null;
        await replaceLines(tx, {
          invoiceId: id,
          supplierId: supplier.id,
          invoiceDate,
          subtotalMinor,
          lines: x.lines ?? [],
        });
        await tx.update(documents)
          .set({ supplierId: supplier.id, ...(doc.kind === "UNKNOWN" ? { kind: invoiceKind } : {}) })
          .where(eq(documents.id, doc.id));
        await recordAudit({
          actorId,
          action: "DOCUMENT_REREAD",
          entityType: "invoice",
          entityId: id,
          after: {
            الملف: doc.fileName,
            السبب: wasArchived
              ? "أُرشف ولم يُقيَّد — قُيِّد آلياً من قراءته المحفوظة بعد التحقّق أنّه ليس نسخة"
              : "قُيِّدت من القراءة المحفوظة — لم يُعَد النداء",
            التاريخ: date,
          },
        }, tx);
        await applySupplierCredit(tx, supplier.id, { forwardDays: SETTLEMENT_FORWARD_DAYS });
        return id;
      });
      /* قيدٌ سبقه قيدٌ من نافذةٍ أخرى — لا يُعدّ ولا يُسكَت عنه */
      if (!invoiceId) {
        out.missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: [`قُيِّدت فاتورةٌ برقم ${number} لهذا المورّد للتوّ`] });
        continue;
      }
      out.recorded++;
      out.items.push(item);
      recordedInvoices.push({ id: invoiceId, supplierId: supplier.id, invoiceNumber: number, invoiceDate: date, totalMinor });
    } catch (e) {
      if (!(e instanceof MonthClosedError)) throw e;
      out.missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: [e.message] });
    }
  }
  return out;
}
