/**
 * تحليل مستند مرفوع: يقرأ الملف نفسه، يستخرج حقوله، يطابق المورد،
 * يفحص الصحة، ويقترح الاسم والمجلد.
 *
 * لا يرفع شيئاً إلى الدرايف — الرفع خطوة مستقلة بعد تأكيد المستخدم.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, gt, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { documents, extractionCache, invoices } from "@/db/schema";
import { withDeadline } from "@/lib/ai/deadline";
import { extractDocument, isSupportedUpload, uploadMimeType } from "@/lib/extraction";
import { runPipeline } from "@/lib/extraction/pipeline";
import type { ExtractionOutcome, ExtractionSuccess } from "@/lib/extraction/provider";
import { matchSupplier } from "@/lib/supplier-match";
import { companyConfig } from "@/config/drive";
import { guard, respondTo } from "@/services/guard";
import { loadSupplierRecords } from "@/services/upload-review.service";

export const runtime = "nodejs";
export const maxDuration = 60;

/*
  حدُّ المنصّة لجسم الطلب ٤٫٥ ميجابايت — فالحدّ هنا تحته، ويُقال قبل
  الإرسال. كان ٢٥ فيردّ Vercel بـ٤١٣ نصّيّ قبل أن تبلغ الشيفرة.
*/
const MAX_BYTES = 4 * 1024 * 1024;


export async function POST(request: Request) {
  /* النداء لا يعيش أطول من المسار — يقف بمهلةٍ معلَنة قبل أن يُقتَل */
  return withDeadline(55_000, () => handle(request));
}

async function handle(request: Request) {
  // المحرس طبقة أولى؛ هذا الفحص هو الحاجز الفعلي.
  let user;
  try {
    user = await guard("analyze", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "لم يصل ملف" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "حجم الملف يتجاوز ٤ ميجابايت — صغّره (صوّره بدقّة أقلّ) ثمّ أعد المحاولة" }, { status: 400 });
  }
  /* كروم يرسل HEIC بنوعٍ فارغ — فيُعرف من الامتداد */
  const mimeType = uploadMimeType(file.type, file.name);
  if (!isSupportedUpload(mimeType)) {
    return NextResponse.json(
      { error: `نوع غير مدعوم (${mimeType || "مجهول"}) — المقبول PDF أو صورة (JPG · PNG · HEIC)` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  /* بصمةُ الدرايف — لما قيّدته المزامنةُ بالاسم بلا تنزيل فلا `sha256` له */
  const md5 = createHash("md5").update(buffer).digest("hex");

  /*
    ── «أعندنا هو؟» قبل «ما فيه؟» ──

    كان الملفّ يُقرأ بالذكاء ويُدفع ثمنه، ثمّ يُقال في آخرها «رُفع من قبل».
    فيُسأل بالبصمة أوّلاً — والمرفوض لا يُعدّ مرفوعاً.
  */
  const [duplicateFile] = await db
    .select({ id: documents.id, fileName: documents.fileName })
    .from(documents)
    .where(and(
      or(eq(documents.sha256, sha256), eq(documents.driveMd5, md5)),
      ne(documents.status, "REJECTED"),
    ))
    .limit(1);
  if (duplicateFile) {
    return NextResponse.json(
      {
        error: `هذا الملف رُفع من قبل («${duplicateFile.fileName}») — لم يُقرأ ثانيةً`,
        duplicateDocumentId: duplicateFile.id,
      },
      { status: 409 },
    );
  }

  const supplierList = await loadSupplierRecords();

  /*
    قراءةٌ حُفظت لهذا الملفّ خلال الساعة لا تُدفع ثانيةً.

    انقطع الردُّ على الجوّال فأُعيد الرفع: كان يُقرأ بالذكاء من جديد وقد
    حُفظت قراءتُه قبل ثوانٍ في extraction_cache — نداءان إلى أربعة تُدفع
    ثانيةً عن الملفّ نفسه.
  */
  const [recent] = await db
    .select({ extraction: extractionCache.extraction, model: extractionCache.model, textSource: extractionCache.textSource })
    .from(extractionCache)
    .where(and(eq(extractionCache.sha256, sha256), gt(extractionCache.createdAt, new Date(Date.now() - 60 * 60 * 1000))))
    .limit(1);

  const extraction: ExtractionOutcome = recent
    ? {
        ok: true,
        value: recent.extraction as ExtractionSuccess["value"],
        model: recent.model ?? "cache",
        provider: "deepseek",
        usage: { inputTokens: 0, outputTokens: 0 },
        textSource: (recent.textSource ?? undefined) as ExtractionSuccess["textSource"],
      }
    : await extractDocument({
        data: buffer,
        mimeType,
        companyVat: companyConfig.vatNumber,
        companyName: companyConfig.nameAr,
        supplierNames: supplierList.map((s) => `${s.nameAr} (${s.slug})`),
      });

  if (!extraction.ok) {
    return NextResponse.json({ error: extraction.reason }, { status: 502 });
  }

  /* ما قرأه النموذج يُحفظ هنا، وتقرؤه الأرشفة ببصمة الملفّ — لا من المتصفّح */
  await db.insert(extractionCache).values({
    sha256,
    extraction: extraction.value as never,
    model: extraction.model,
    textSource: extraction.textSource ?? null,
    userId: user.id,
  }).onConflictDoUpdate({
    target: extractionCache.sha256,
    set: {
      extraction: extraction.value as never, model: extraction.model,
      textSource: extraction.textSource ?? null, userId: user.id, createdAt: new Date(),
    },
  });

  const match = matchSupplier(supplierList, {
    sellerVatNumber: extraction.value.sellerVatNumber,
    supplierNameAr: extraction.value.supplierNameAr,
    supplierNameEn: extraction.value.supplierNameEn,
  });

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
    fileAlreadyUploaded: false,
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
