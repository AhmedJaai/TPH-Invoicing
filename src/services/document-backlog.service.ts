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

/**
 * يقيّد فاتورةً لكلّ مستندٍ ينتظر ولا فاتورةَ له، من قراءته المحفوظة.
 * يُعيد ما قُيِّد، وما بقي ومعه ما نقصه.
 */
export async function recordFromStoredReadings(actorId: string, limit = 60): Promise<{
  recorded: number;
  missing: { documentId: string; fileName: string; reasons: string[] }[];
}> {
  const pending = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      supplierId: documents.supplierId,
      periodMonth: documents.periodMonth,
      reading: documents.extractionJson,
    })
    .from(documents)
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .leftJoin(statements, eq(statements.documentId, documents.id))
    .where(and(
      inArray(documents.status, ["PENDING", "NEEDS_REVIEW"]),
      isNotNull(documents.extractionJson),
      isNull(invoices.id),
      isNull(statements.id),
    ))
    .limit(limit);

  if (pending.length === 0) return { recorded: 0, missing: [] };

  const supplierList = await loadSuppliers();
  const byId = new Map(supplierList.map((s) => [s.id, s]));
  let recorded = 0;
  const missing: { documentId: string; fileName: string; reasons: string[] }[] = [];

  for (const doc of pending) {
    const x = (doc.reading ?? {}) as StoredReading;
    const kind = x.documentKind ?? "";
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

    /*
      ── الكشف ── هويّتُه مورّدُه وفترتُه، لا رقمٌ ولا إجماليّ. وتاريخُه إن
      لم يُقرأ فآخرُ يومٍ من شهر مجلّده (كتبه إنسان) — فالكشفُ لا يُحجَز
      بسؤالٍ لا يعنيه.
    */
    if (kind === "STATEMENT") {
      if (!supplier) {
        missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: ["المورّد: لم يُعرَف من الاسم المقروء"] });
        continue;
      }
      const end = date ?? (doc.periodMonth ? lastDayOf(doc.periodMonth) : null);
      if (!end) {
        missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: ["التاريخ: لم يُقرأ، ولا شهرَ للمجلّد"] });
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
          recorded++;
        });
      } catch (e) {
        if (!(e instanceof MonthClosedError)) throw e;
        missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: [e.message] });
      }
      continue;
    }

    const review = reviewConfirmed(
      {
        documentKind: kind,
        supplierId: supplier?.id,
        invoiceNumber: number,
        invoiceDate: date,
        subtotalMinor: parseRiyals(x.subtotalAmount ?? ""),
        vatMinor: parseRiyals(x.vatAmount ?? ""),
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
      missing.push({
        documentId: doc.id,
        fileName: doc.fileName,
        reasons: missingFromReading({
          supplierKnown: Boolean(supplier), invoiceNumber: number, invoiceDate: date, totalMinor,
          rawDate: x.invoiceDate?.trim() || null,
        }),
      });
      continue;
    }

    try {
      await db.transaction(async (tx) => {
        const invoiceDate = new Date(`${date}T00:00:00Z`);
        const invoiceId = await createInvoice(tx, {
          documentId: doc.id,
          supplierId: supplier.id,
          invoiceNumber: number,
          invoiceDate,
          periodMonth: doc.periodMonth || date.slice(0, 7),
          subtotalMinor: parseRiyals(x.subtotalAmount ?? ""),
          vatMinor: parseRiyals(x.vatAmount ?? ""),
          totalMinor,
          sellerVat: x.sellerVatNumber || null,
          buyerVat: x.buyerVatNumber || null,
          taxStatus: review.taxStatus,
          inputVatStatus: review.inputVatStatus,
          isFixedAsset: review.isFixedAsset,
        });
        if (!invoiceId) return;
        await replaceLines(tx, {
          invoiceId,
          supplierId: supplier.id,
          invoiceDate,
          subtotalMinor: parseRiyals(x.subtotalAmount ?? ""),
          lines: (x.lines ?? []) as never,
        });
        if (!doc.supplierId) {
          await tx.update(documents).set({ supplierId: supplier.id }).where(eq(documents.id, doc.id));
        }
        await recordAudit({
          actorId,
          action: "DOCUMENT_REREAD",
          entityType: "invoice",
          entityId: invoiceId,
          after: {
            الملف: doc.fileName,
            السبب: "قُيِّدت من القراءة المحفوظة بعد توحيد التاريخ — لم يُعَد النداء",
            التاريخ: date,
          },
        }, tx);
        await applySupplierCredit(tx, supplier.id, { forwardDays: SETTLEMENT_FORWARD_DAYS });
        recorded++;
      });
    } catch (e) {
      if (!(e instanceof MonthClosedError)) throw e;
      missing.push({ documentId: doc.id, fileName: doc.fileName, reasons: [e.message] });
    }
  }
  return { recorded, missing };
}
