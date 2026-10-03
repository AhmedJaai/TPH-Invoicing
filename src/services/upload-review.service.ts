/**
 * مراجعةُ الرفع بعد تعديل الإنسان — الحكمُ نفسُه على القراءة نفسها، بما صحّحه.
 *
 * كان الحكمُ (`canArchive` والاسمُ والمجلدُ والشهر) يُبنى مرّةً حين يُقرأ الملفّ ولا يُعاد.
 * فكشفُ أوراق الزيتون (٣ أكتوبر ٢٠٢٦) لم يُقرأ تاريخُه، فكتبه أحمد بيده — وبقي الزرُّ
 * مقفلاً، والشهرُ «يُحدَّد من التاريخ» فارغاً، ولا طريقَ إلى الأرشفة. فتُعاد هنا
 * `runPipeline` على ما قرأه الخادم (`extraction_cache`، لا ما يرسله المتصفّح) بعد أن
 * يُكتب فوقه ما صحّحه الإنسان: المورّدُ المختار، والرقم، والتاريخ، والضريبة، والإجمالي.
 * بلا نموذجٍ ثانٍ — والأرشفةُ تعيد الحكم كعادتها.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { extractionCache, invoices, supplierAliases, suppliers } from "@/db/schema";
import { companyConfig } from "@/config/drive";
import { runPipeline, type PipelineResult } from "@/lib/extraction/pipeline";
import type { ExtractionResult } from "@/lib/extraction/schema";
import { applyEdits, type ReviewEdits } from "@/lib/extraction/apply-edits";
import { matchSupplier, type SupplierMatch, type SupplierRecord } from "@/lib/supplier-match";

export async function loadSupplierRecords(): Promise<SupplierRecord[]> {
  const rows = await db
    .select({
      id: suppliers.id,
      slug: suppliers.slug,
      nameAr: suppliers.nameAr,
      nameEn: suppliers.nameEn,
      driveFolderName: suppliers.driveFolderName,
      vatNumber: suppliers.vatNumber,
      issuesInvoices: suppliers.issuesInvoices,
      contractOnFile: suppliers.contractOnFile,
    })
    .from(suppliers)
    .where(eq(suppliers.isActive, true));

  const ids = rows.map((r) => r.id);
  const aliasRows = ids.length
    ? await db
        .select({ supplierId: supplierAliases.supplierId, normalized: supplierAliases.normalized })
        .from(supplierAliases)
        .where(inArray(supplierAliases.supplierId, ids))
    : [];

  return rows.map((r) => ({
    ...r,
    aliases: aliasRows.filter((a) => a.supplierId === r.id).map((a) => ({ normalized: a.normalized })),
  }));
}

export async function existingNumbersOf(supplierId: string | undefined): Promise<string[]> {
  if (!supplierId) return [];
  return (await db.select({ n: invoices.invoiceNumber }).from(invoices).where(eq(invoices.supplierId, supplierId))).map((r) => r.n);
}


export class UploadReviewMissing extends Error {}

export async function reviewUpload(sha256: string, originalFileName: string, edits: ReviewEdits): Promise<PipelineResult> {
  const [cached] = await db.select({ extraction: extractionCache.extraction }).from(extractionCache)
    .where(eq(extractionCache.sha256, sha256)).limit(1);
  if (!cached) throw new UploadReviewMissing("لم تُحفظ قراءةُ هذا الملفّ — أزِله وارفعه ثانيةً");
  const x = applyEdits(cached.extraction as ExtractionResult, edits);

  const list = await loadSupplierRecords();
  const picked = edits.supplierId ? list.find((s) => s.id === edits.supplierId) : undefined;
  const auto = matchSupplier(list, { sellerVatNumber: x.sellerVatNumber, supplierNameAr: x.supplierNameAr, supplierNameEn: x.supplierNameEn });
  /* المورّدُ الذي اختاره الإنسان قرارُه — لا يُعاد تخمينُه */
  const match: SupplierMatch = picked ? { supplier: picked, method: auto.method, confidence: 1, candidates: auto.candidates } : auto;
  if (picked) x.confidence = { ...x.confidence, supplierName: 1 };

  return runPipeline({
    extraction: x,
    match,
    companyVat: companyConfig.vatNumber,
    originalFileName,
    existingInvoiceNumbers: await existingNumbersOf(match.supplier?.id),
    fileAlreadyUploaded: false,
  });
}
