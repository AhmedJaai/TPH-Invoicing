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
import { documents, invoices, supplierAliases, suppliers } from "@/db/schema";
import { reviewConfirmed } from "@/lib/confirm";
import { normalizeDocumentDate } from "@/lib/document-date";
import { parseRiyals } from "@/lib/money";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import { companyConfig } from "@/config/drive";
import { createInvoice, replaceLines } from "@/services/invoice.service";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { recordAudit } from "@/lib/audit";
import { MonthClosedError } from "@/services/validation.service";

interface StoredReading {
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

async function loadSuppliers(): Promise<SupplierRecord[]> {
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
    .where(and(
      inArray(documents.status, ["PENDING", "NEEDS_REVIEW"]),
      isNotNull(documents.extractionJson),
      isNull(invoices.id),
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
    if (!INVOICE_KINDS.has(kind)) continue;

    const supplier = (doc.supplierId ? byId.get(doc.supplierId) : undefined)
      ?? matchSupplier(supplierList, {
        sellerVatNumber: x.sellerVatNumber,
        supplierNameAr: x.supplierNameAr,
        supplierNameEn: x.supplierNameEn,
      }).supplier
      ?? undefined;
    const date = normalizeDocumentDate(x.invoiceDate);
    const number = x.invoiceNumber?.trim() || null;
    const totalMinor = parseRiyals(x.totalAmount ?? "");

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
