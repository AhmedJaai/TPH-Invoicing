/**
 * قراءةُ ملفٍّ للمراجعة — ما يقف عليه «اعتمد»: البصمةُ والتكرار، والقراءةُ (المحفوظةُ
 * إن وُجدت)، ومطابقةُ المورّد وقواعدُ الفاتورة، وحركةُ الأسعار.
 *
 * كانت في `/api/analyze` وحده، والملفُّ لا يصلها إلّا من المتصفّح. فصورةُ الفريق — وهي
 * في القاعدة أصلاً — كانت تُنزَّل إلى المتصفّح ثمّ تُرفع إليه ثانيةً لتُقرأ قراءتُها
 * المحفوظة. والآن يُستدعى هذا بالبايتات نفسها من أيّ باب، والقواعدُ واحدة.
 */
import { createHash } from "node:crypto";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { extractDocument } from "@/lib/extraction";
import { runPipeline } from "@/lib/extraction/pipeline";
import { fillFromFileName } from "@/lib/extraction/filename-facts";
import { isReaderOutage, type ExtractionOutcome } from "@/lib/extraction/provider";
import { loadCachedReading, saveCachedReading } from "./reading-cache.service";
import { matchSupplier } from "@/lib/supplier-match";
import { companyConfig } from "@/config/drive";
import { can } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/session";
import { itemKeys, priceMovesAtReview, type PriceMove } from "@/lib/price-at-review";
import { loadLastItemPrices } from "./price-review.service";
import { loadSupplierRecords, numbersForPipeline } from "./upload-review.service";
import { CAPTURE_READING_MAX_AGE_MS, isWaitingCapture } from "./capture.service";

/** الجوابُ كما يُرسَل: رمزُ الحال وجسمُه — والمسارُ يلفّه بـ`NextResponse` */
export interface Reply { status: number; body: Record<string, unknown> }
const reply = (body: Record<string, unknown>, init?: { status: number }): Reply => ({ status: init?.status ?? 200, body });

export async function analyzeForReview(buffer: Buffer, mimeType: string, fileName: string, user: CurrentUser): Promise<Reply> {
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
    return reply(
      {
        error: `رُفع هذا الملف من قبل («${duplicateFile.fileName}»)، فلم يُقرأ مرة أخرى.`,
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
  /* صورةٌ من الفريق قُرئت يوم وصلت — قراءتُها صالحةٌ حتّى تُفتح، لا ساعةً وحدها */
  const recent = await loadCachedReading(sha256, (await isWaitingCapture(sha256)) ? CAPTURE_READING_MAX_AGE_MS : 60 * 60 * 1000);

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
      return reply(
        {
          error: extraction.kind === "NO_BALANCE"
            ? "قراءة المستندات متوقفة لأن رصيد القارئ نفد. ملفك سليم ولم يُحفظ شيء. أبلغ مالك الحساب ليشحن الرصيد، ثم أعد الرفع."
            : `قراءة المستندات متوقفة مؤقتاً (${extraction.reason}). ملفك سليم ولم يُحفظ شيء. أعد المحاولة بعد دقائق.`,
          readerOutage: extraction.kind,
        },
        { status: extraction.kind === "NO_BALANCE" ? 402 : 503 },
      );
    }
    return reply({ error: extraction.reason }, { status: 502 });
  }

  /*
    ما سكت عنه النموذجُ ونطق به اسمُ الملفّ — البابُ نفسُه الذي تمرّ به المزامنة. كانت
    فاتورةُ أوراق الزيتون «فاتورة - 260340 - …» تُقيَّد من الدرايف وتُقفل حين تُرفع من هنا.
    ويُسدّ قبل الحفظ: الأرشفةُ تقرأ القراءةَ المحفوظة نفسها.
  */
  fillFromFileName(extraction.value, fileName, extraction.evidence?.provenance);

  /* ما قرأه النموذج — وأدلّتُه — يُحفظ هنا، وتقرؤه الأرشفة ببصمة الملفّ لا من المتصفّح */
  if (!recent) await saveCachedReading(sha256, extraction, user.id);

  const match = matchSupplier(supplierList, {
    sellerVatNumber: extraction.value.sellerVatNumber,
    supplierNameAr: extraction.value.supplierNameAr,
    supplierNameEn: extraction.value.supplierNameEn,
  });

  /* ما قُيِّد من كشف المورّد بلا ملفّ ليس تكراراً — هذا ملفُّه (057) */
  const result = runPipeline({
    extraction: extraction.value,
    match,
    companyVat: companyConfig.vatNumber,
    originalFileName: fileName,
    ...(await numbersForPipeline(match.supplier?.id)),
    fileAlreadyUploaded: false,
  });

  /*
    سعرُ كلّ بندٍ مقابل آخر سعرٍ قُيِّد له عند المورّد نفسه — يُقال لحظةَ المراجعة
    والمندوبُ عند الباب، لا بعد القيد. ولمن يرى المبالغ وحده، وللمورّد المعروف وحده.
    وتعذُّرُه لا يُسقط القراءة: هو عونٌ لا شرط.
  */
  let priceMoves: PriceMove[] = [];
  if (match.supplier && can(user.role, "amounts:view") && extraction.value.lines.length > 0) {
    try {
      const last = await loadLastItemPrices(match.supplier.id, itemKeys(extraction.value.lines));
      priceMoves = priceMovesAtReview(extraction.value.lines, last).slice(0, 20);
    } catch (e) {
      console.error("[analyze] تعذّرت مقارنة الأسعار", e);
    }
  }

  return reply({
    originalFileName: fileName,
    sizeBytes: buffer.length,
    priceMoves,
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
