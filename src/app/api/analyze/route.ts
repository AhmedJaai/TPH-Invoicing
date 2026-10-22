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
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة، وإن تكرر ذلك فأبلغ مالك الحساب." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "لم يصل أي ملف" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "الملف فارغ" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "حجم الملف أكبر من ٤ ميجابايت. صغّره (صوّره بدقة أقل) ثم أعد المحاولة." }, { status: 400 });
  }
  /* كروم يرسل HEIC بنوعٍ فارغ — فيُعرف من الامتداد */
  const declaredType = uploadMimeType(file.type, file.name);
  if (!isSupportedUpload(declaredType)) {
    return NextResponse.json(
      { error: `نوع الملف غير مدعوم (${declaredType || "مجهول"}). المقبول ملف PDF أو صورة (JPG · PNG · HEIC).` },
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
      { error: "الملف ليس PDF ولا صورة. تأكد منه ثم أعد المحاولة." },
      { status: 400 },
    );
  }
  const mimeType = signatureMatches(declaredType, buffer) ? declaredType : sniffed;
  const out = await analyzeForReview(buffer, mimeType, file.name, user);
  return NextResponse.json(out.body, { status: out.status });
}
