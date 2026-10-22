/**
 * إرسالُ صورة الباريستا إلى الانتظار — بلا جلسة، والرمزُ إذنُه.
 *
 *   POST multipart { token, draftId | file, note? } → { id } | { duplicate } | { missing }
 *
 * بـ`draftId` (مسودّةُ الفحص) لا تُرفع الصورةُ ثانيةً. و`missing`: لا مسودّةَ بهذا
 * المعرّف لهذا الرابط، فيرسلها الجوالُ بملفّها.
 *
 * تُحفظ في القاعدة لا في الدرايف، وتنتظر صاحبَ العمل في شاشة الرفع. وإن لم
 * تُقرأ في الفحص (القارئ متوقّف) فتُقرأ بعد الردّ — لا ينتظرها المصوِّر.
 */
import { after, NextResponse } from "next/server";
import { withDeadline } from "@/lib/ai/deadline";
import { failWith } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { CAPTURE_READING_MAX_AGE_MS, CaptureInputError, inspectFile, readCaptureLater, resolveLink, saveCapture, submitDraft } from "@/services/capture.service";
import { loadCachedReading } from "@/services/reading-cache.service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "لم تصل الصورة كاملة. أعد المحاولة." }, { status: 400 });
    }
    const link = await resolveLink(String(form.get("token") ?? ""));
    if (!link) return NextResponse.json({ error: "هذا الرابط لم يعد يعمل. اطلب رابطاً جديداً من المدير." }, { status: 404 });
    await consume("capture-submit", link.id);

    const noteField = form.get("note");
    const note = typeof noteField === "string" ? noteField : null;
    const draftId = form.get("draftId");
    if (typeof draftId === "string" && draftId !== "") {
      const sent = await submitDraft(link, draftId, note);
      if (!sent) return NextResponse.json({ missing: true });
      if (!(await loadCachedReading(sent.sha256, CAPTURE_READING_MAX_AGE_MS))) {
        after(() => withDeadline(55_000, () => readCaptureLater(sent.id, link.createdById)));
      }
      return NextResponse.json({ id: sent.id });
    }

    const file = await inspectFile(form.get("file"));
    const saved = await saveCapture(link, file, note);
    if (saved.kind === "DUPLICATE") return NextResponse.json({ duplicate: saved.where });

    if (!(await loadCachedReading(file.sha256, CAPTURE_READING_MAX_AGE_MS))) {
      after(() => withDeadline(55_000, () => readCaptureLater(saved.id, link.createdById)));
    }
    return NextResponse.json({ id: saved.id });
  } catch (e) {
    if (e instanceof CaptureInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    return failWith(e, "capture-submit");
  }
}
