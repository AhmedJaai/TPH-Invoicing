/**
 * تحليل مستند مرفوع: يقرأ الملف نفسه، يستخرج حقوله، يطابق المورد،
 * يفحص الصحة، ويقترح الاسم والمجلد.
 *
 * لا يرفع شيئاً إلى الدرايف — الرفع خطوة مستقلة بعد تأكيد المستخدم.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, supplierAliases, suppliers } from "@/db/schema";
import { extractDocument, isSupportedUpload } from "@/lib/extraction";
import { runPipeline } from "@/lib/extraction/pipeline";
import { matchSupplier, type SupplierRecord } from "@/lib/supplier-match";
import { companyConfig } from "@/config/drive";
import { requireUser, UnauthenticatedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;

async function loadSuppliers(): Promise<SupplierRecord[]> {
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

export async function POST(request: Request) {
  // المحرس طبقة أولى؛ هذا الفحص هو الحاجز الفعلي.
  try {
    await requireUser("document:upload");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "لم يصل ملف" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "حجم الملف يتجاوز ٢٥ ميجابايت" }, { status: 400 });
  }
  if (!isSupportedUpload(file.type)) {
    return NextResponse.json(
      { error: `نوع غير مدعوم (${file.type || "مجهول"}) — المقبول PDF أو صورة` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const supplierList = await loadSuppliers();

  const extraction = await extractDocument({
    data: buffer,
    mimeType: file.type,
    companyVat: companyConfig.vatNumber,
    companyName: companyConfig.nameAr,
    supplierNames: supplierList.map((s) => `${s.nameAr} (${s.slug})`),
  });

  if (!extraction.ok) {
    return NextResponse.json({ error: extraction.reason }, { status: 502 });
  }

  const match = matchSupplier(supplierList, {
    sellerVatNumber: extraction.value.sellerVatNumber,
    supplierNameAr: extraction.value.supplierNameAr,
    supplierNameEn: extraction.value.supplierNameEn,
  });

  // بصمة الملف تكشف رفع النسخة نفسها ولو تغيّر اسمها
  const [duplicateFile] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.sha256, sha256))
    .limit(1);

  const existingInvoiceNumbers = match.supplier
    ? (
        await db
          .select({ invoiceNumber: invoices.invoiceNumber })
          .from(invoices)
          .where(eq(invoices.supplierId, match.supplier.id))
      ).map((r) => r.invoiceNumber)
    : [];

  const result = runPipeline({
    extraction: extraction.value,
    match,
    companyVat: companyConfig.vatNumber,
    originalFileName: file.name,
    existingInvoiceNumbers,
    fileAlreadyUploaded: Boolean(duplicateFile),
  });

  return NextResponse.json({
    originalFileName: file.name,
    sizeBytes: file.size,
    sha256,
    model: extraction.model,
    provider: extraction.provider,
    usage: extraction.usage,
    extraction: extraction.value,
    supplierMatch: {
      method: match.method,
      confidence: match.confidence,
      candidates: match.candidates.map((c) => ({ id: c.id, slug: c.slug, nameAr: c.nameAr })),
    },
    result: {
      ...result,
      supplier: result.supplier
        ? { id: result.supplier.id, slug: result.supplier.slug, nameAr: result.supplier.nameAr }
        : undefined,
      supplierCandidates: result.supplierCandidates.map((c) => ({
        id: c.id,
        slug: c.slug,
        nameAr: c.nameAr,
      })),
    },
  });
}
