/**
 * تحليل مستند مرفوع: يقرأ الملف نفسه، يستخرج حقوله، يطابق المورد،
 * يفحص الصحة، ويقترح الاسم والمجلد.
 *
 * لا يرفع شيئاً إلى الدرايف — الرفع خطوة مستقلة بعد تأكيد المستخدم.
 */
import { signatureMatches, sniffMimeType } from "@/lib/file-signature";
import { NextResponse } from "next/server";
import { withDeadline } from "@/lib/ai/deadline";
import { isSupportedUpload, uploadMimeType } from "@/lib/extraction";
import { guard, respondTo } from "@/services/guard";
import { analyzeForReview } from "@/services/analyze.service";
import { readJson } from "@/lib/request-body";
import { discardStaged, readStaged, StagedFileError } from "@/lib/blob-staging";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

/*
  حدُّ المنصّة لجسم الطلب ٤٫٥ ميجابايت — فالحدّ هنا تحته، ويُقال قبل
  الإرسال. كان ٢٥ فيردّ Vercel بـ٤١٣ نصّيّ قبل أن تبلغ الشيفرة.
*/
const MAX_BYTES = 4 * 1024 * 1024;

/** ملفٌّ كبير في المحطّة المؤقّتة — رابطُه وحده يصل، والخادمُ يقرؤه (`blob-staging.ts`) */
const StagedBody = z.object({
  blobUrl: z.string().max(1000),
  fileName: z.string().min(1).max(300),
  mimeType: z.string().max(120),
});


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

  /*
    الملفّ الكبير لا يمرّ بالطلب: رفعه المتصفّحُ إلى المحطّة المؤقّتة (`/api/upload/blob`)،
    ويصل رابطُه وحده فيُقرأ هنا بمفتاح الخادم. والفحوصُ بعدها نفسُها.
  */
  let incoming: { buffer: Buffer; size: number; type: string; name: string; stagedUrl?: string };
  if ((request.headers.get("content-type") ?? "").startsWith("application/json")) {
    const read = await readJson(request, StagedBody);
    if (!read.ok) return read.response;
    try {
      const buffer = await readStaged(read.body.blobUrl);
      incoming = { buffer, size: buffer.length, type: read.body.mimeType, name: read.body.fileName, stagedUrl: read.body.blobUrl };
    } catch (e) {
      if (e instanceof StagedFileError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  } else {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة، وإن تكرر ذلك فأبلغ مالك الحساب." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "لم يصل أي ملف" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "حجم الملف أكبر من 4 ميجابايت. صغّره (صوّره بدقة أقل) ثم أعد المحاولة." }, { status: 400 });
    }
    incoming = { buffer: Buffer.from(await file.arrayBuffer()), size: file.size, type: file.type, name: file.name };
  }

  const out = await analyzeIncoming(incoming, user);
  /* ما لم يُقرأ قراءةً تُراجَع لا يبقى في المحطّة — «أعد المحاولة» يرفعه من جديد */
  if (incoming.stagedUrl && out.status !== 200) await discardStaged(incoming.stagedUrl);
  return NextResponse.json(out.body, { status: out.status });
}

async function analyzeIncoming(
  file: { buffer: Buffer; size: number; type: string; name: string },
  user: Awaited<ReturnType<typeof guard>>,
): Promise<{ body: unknown; status: number }> {
  if (file.size === 0) {
    return { body: { error: "الملف فارغ" }, status: 400 };
  }
  /* كروم يرسل HEIC بنوعٍ فارغ — فيُعرف من الامتداد */
  const declaredType = uploadMimeType(file.type, file.name);
  if (!isSupportedUpload(declaredType)) {
    return {
      body: { error: `نوع الملف غير مدعوم (${declaredType || "مجهول"}). المقبول ملف PDF أو صورة (JPG · PNG · HEIC).` },
      status: 400,
    };
  }

  const buffer = file.buffer;
  /*
    النوعُ من بصمة الملفّ لا ممّا أعلنه المتصفّح: ما لا بصمةَ مقبولةً له لا يبلغ
    محلِّلاً. وما أُعلن بنوعٍ وبصمتُه نوعٌ آخر مقبول (صورةُ آيفون حُوِّلت JPEG
    وبقي اسمُها HEIC) يُقرأ بنوعه الحقيقيّ — لا يُردّ على صاحبه.
  */
  const sniffed = sniffMimeType(buffer);
  if (!sniffed) {
    return { body: { error: "الملف ليس PDF ولا صورة. تأكد منه ثم أعد المحاولة." }, status: 400 };
  }
  const mimeType = signatureMatches(declaredType, buffer) ? declaredType : sniffed;
  const out = await analyzeForReview(buffer, mimeType, file.name, user);
  return { body: out.body, status: out.status };
}
