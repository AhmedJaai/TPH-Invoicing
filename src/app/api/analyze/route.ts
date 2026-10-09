/**
 * تحليل مستند مرفوع: يقرأ الملف نفسه، يستخرج حقوله، يطابق المورد،
 * يفحص الصحة، ويقترح الاسم والمجلد.
 *
 * لا يرفع شيئاً إلى الدرايف — الرفع خطوة مستقلة بعد تأكيد المستخدم.
 */
import { signatureMatches, sniffMimeType } from "@/lib/file-signature";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices } from "@/db/schema";
import { withDeadline } from "@/lib/ai/deadline";
import { extractDocument, isSupportedUpload, uploadMimeType } from "@/lib/extraction";
import { runPipeline } from "@/lib/extraction/pipeline";
import { fillFromFileName } from "@/lib/extraction/filename-facts";
import { isReaderOutage, type ExtractionOutcome } from "@/lib/extraction/provider";
import { loadCachedReading, saveCachedReading } from "@/services/reading-cache.service";
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
  const declaredType = uploadMimeType(file.type, file.name);
  if (!isSupportedUpload(declaredType)) {
    return NextResponse.json(
      { error: `نوع غير مدعوم (${declaredType || "مجهول"}) — المقبول PDF أو صورة (JPG · PNG · HEIC)` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  /*
    النوعُ من بصمة الملفّ لا ممّا أعلنه المتصفّح: ما لا بصمةَ مقبولةً له لا يبلغ
    محلِّلاً. وما أُعلن بنوعٍ وبصمتُه نوعٌ آخر مقبول (صورةُ آيفون حُوِّلت JPEG
    وبقي اسمُها HEIC) يُقرأ بنوعه الحقيقيّ — لا يُردّ على صاحبه.
  */
  const sniffed = sniffMimeType(buffer);
  if (!sniffed) {
    return NextResponse.json(
      { error: "محتوى الملفّ ليس PDF ولا صورة — تأكّد من الملفّ ثمّ أعد المحاولة" },
      { status: 400 },
    );
  }
  const mimeType = signatureMatches(declaredType, buffer) ? declaredType : sniffed;
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
  /* تُفحص بالمخطّط وبنسخة الموجِّه — ما لا يطابق القائمَ يُقرأ من جديد (`reading-cache.service`) */
  const recent = await loadCachedReading(sha256, 60 * 60 * 1000);

  const extraction: ExtractionOutcome = recent
    ?? await extractDocument({
        data: buffer,
        mimeType,
        companyVat: companyConfig.vatNumber,
        companyName: companyConfig.nameAr,
        supplierNames: supplierList.map((s) => `${s.nameAr} (${s.slug})`),
      });

  if (!extraction.ok) {
    /*
      «القارئ متوقّف» ليس «الملفّ لا يُقرأ»: الأوّل لا يُصلحه تصويرٌ أوضح. فيُقال
      لمن يرفع ما وقع — ٤٠٢ لرصيدٍ نفد، ٥٠٣ لانقطاعٍ أو قارئٍ غير مهيّأ — وأنّ ملفَّه سليم.
    */
    if (isReaderOutage(extraction)) {
      console.error(`[analyze] القارئ متوقّف (${extraction.kind}): ${extraction.reason}`);
      return NextResponse.json(
        {
          error: extraction.kind === "NO_BALANCE"
            ? "قراءةُ المستندات متوقّفة: نفد رصيدُ القارئ. ملفُّك سليم ولم يُحفَظ شيء — أبلِغ مالك الحساب ليشحن الرصيد، ثمّ أعد الرفع."
            : `قراءةُ المستندات متوقّفة مؤقّتاً (${extraction.reason}). ملفُّك سليم ولم يُحفَظ شيء — أعد المحاولة بعد دقائق.`,
          readerOutage: extraction.kind,
        },
        { status: extraction.kind === "NO_BALANCE" ? 402 : 503 },
      );
    }
    return NextResponse.json({ error: extraction.reason }, { status: 502 });
  }

  /*
    ما سكت عنه النموذجُ ونطق به اسمُ الملفّ — البابُ نفسُه الذي تمرّ به المزامنة. كانت
    فاتورةُ أوراق الزيتون «فاتورة - 260340 - …» تُقيَّد من الدرايف وتُقفل حين تُرفع من هنا.
    ويُسدّ قبل الحفظ: الأرشفةُ تقرأ القراءةَ المحفوظة نفسها.
  */
  fillFromFileName(extraction.value, file.name, extraction.evidence?.provenance);

  /* ما قرأه النموذج — وأدلّتُه — يُحفظ هنا، وتقرؤه الأرشفة ببصمة الملفّ لا من المتصفّح */
  if (!recent) await saveCachedReading(sha256, extraction, user.id);

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
    /* من أين جاء ما لم يقرأه النموذج، وما في رمز الفاتورة — للعرض؛ والخادمُ يقرؤه من حفظه لا من هنا */
    evidence: extraction.evidence ?? null,
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
