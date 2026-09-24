/**
 * المستنداتُ التي تنتظر المراجعة — وحكمُ الشروط الأربعة على كلٍّ منها.
 *
 * مصدرٌ واحد للّوح الذي يشرح، وللفعل الذي يعتمد ما اجتمعت فيه الشروط:
 * فلا يعدّ اللوحُ «٧ تجتمع فيها» ثمّ يعتمد الفعلُ خمسة.
 */

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, suppliers } from "@/db/schema";
import { autoArchive, type AutoArchiveVerdict } from "@/lib/extraction/auto-archive";

export async function loadPendingReview(limit = 200) {
  const rows = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      driveFileId: documents.driveFileId,
      periodMonth: documents.periodMonth,
      status: documents.status,
      kind: documents.kind,
      textSource: documents.textSource,
      invoiceId: invoices.id,
      totalMinor: invoices.totalMinor,
      subtotalMinor: invoices.subtotalMinor,
      vatMinor: invoices.vatMinor,
      invoiceDate: invoices.invoiceDate,
      invoiceNumber: invoices.invoiceNumber,
      sellerVat: invoices.sellerVat,
      supplierId: suppliers.id,
      supplierVat: suppliers.vatNumber,
      supplierName: suppliers.nameAr,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .where(inArray(documents.status, ["PENDING", "NEEDS_REVIEW"]))
    .orderBy(asc(documents.periodMonth))
    .limit(limit);

  return rows.map((d) => ({
    ...d,
    verdict: autoArchive({
      kind: d.kind,
      invoiceRecorded: d.invoiceId !== null,
      textSource: d.textSource,
      supplierKnown: d.supplierId !== null,
      sellerVat: d.sellerVat,
      supplierVat: d.supplierVat,
      subtotalMinor: d.subtotalMinor,
      vatMinor: d.vatMinor,
      totalMinor: d.totalMinor,
    }) as AutoArchiveVerdict,
  }));
}
