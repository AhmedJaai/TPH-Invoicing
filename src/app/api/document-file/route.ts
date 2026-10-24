/**
 * ورقةُ المستند المؤرشف — تُعرَض داخل التطبيق لا في لسانٍ آخر.
 *
 *   GET ?id=<معرّف المستند> → الملفّ نفسُه (PDF أو صورة)
 *
 * كان ملفُّ المستند وبطاقةُ المراجعة يفتحان الدرايف في لسانٍ جديد: من يقارن ما قرأه
 * النموذج بالورقة يقفز بين لسانين، وعلى الجوّال يخرج من التطبيق المثبَّت كلّه.
 *
 * **قراءةٌ محضة:** `downloadFile` وحده — لا تسمية ولا نقل ولا حذف (قيدُ الأرشيف).
 * وبتفويض الناظر نفسه (`refreshTokenFor`)، كما يفتح رابطُ الدرايف بحسابه هو.
 *
 * **الصلاحية `document:view`** — هي صلاحيةُ زرّ «افتح الملف» الذي يحلّ محلّه: كلُّ من
 * يرى ملفَّ المستند كان يفتح ورقته في الدرايف، ومديرُ المشتريات يرفعها بيده. فلا
 * يُضيَّق هنا ما كان مفتوحاً هناك.
 *
 * **ولا يُعرَض إلّا ما يعرضه المتصفّح آمناً:** PDF وصورة، وبايتاتُه تشهد لنوعه —
 * ملفٌّ مؤرشفٌ يدّعي PDF وهو HTML لا يُفتح من أصل التطبيق.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { refreshTokenFor } from "@/services/drive.service";
import { documentFileRef } from "@/services/document-file.service";
import {
  DriveAuthExpiredError, DriveFileTooLargeError, downloadFile, driveForUser, isDriveAuthError, isDriveNotFound,
} from "@/lib/drive";
import { signatureMatches, sniffMimeType } from "@/lib/file-signature";

export const runtime = "nodejs";
export const maxDuration = 60;

/** ما يعرضه المتصفّح في مكانه بلا خطر — وما سواه يُفتح في الدرايف. */
const INLINE_TYPES: ReadonlySet<string> = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

/** يُرسَل قطعاً: ردٌّ واحدٌ كبير يصطدم بحدّ جسم الدالّة، والمتدفّق لا. */
const CHUNK = 256 * 1024;

function streamOf(data: Buffer): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= data.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(data.subarray(at, at + CHUNK)));
      at += CHUNK;
    },
  });
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  let user;
  try {
    user = await guard("document-file", "document:view");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail("معرّف المستند غير صالح", 400);

  const ref = await documentFileRef(id);
  if (!ref) return fail("هذا المستند لم يعد موجوداً في النظام. حدّث الصفحة", 404);
  if (!ref.driveFileId) return fail("لا ملف لهذا المستند في الدرايف، فلا ورقة تُعرض", 404);

  const token = await refreshTokenFor(user.id);
  if (!token) {
    return fail("لا يوجد تفويض للدرايف في هذه البيئة، فلا تُعرض الورقة هنا. افتحها في الدرايف", 409);
  }

  let file: { data: Buffer; mimeType: string };
  try {
    file = await downloadFile(driveForUser(token), ref.driveFileId);
  } catch (e) {
    if (isDriveAuthError(e)) return fail(new DriveAuthExpiredError().message, 428);
    if (e instanceof DriveFileTooLargeError) return fail("الملف أكبر من ٢٥ ميجابايت فلا يُعرض هنا. افتحه في الدرايف", 413);
    if (isDriveNotFound(e)) return fail("الملف لم يعد في مكانه في الدرايف، أو لا تملك صلاحية فتحه", 404);
    /* نصُّ خطأ جوجل (وفيه معرّفُ الملفّ) لسجلّ الخادم لا للشاشة */
    console.error("[document-file] تعذّر تنزيل الورقة:", e);
    return fail("تعذّر جلب الورقة من الدرايف. أعد المحاولة، أو افتحها في الدرايف", 502);
  }

  /* النوعُ المقيَّد أوّلاً، ثمّ ما يقوله الدرايف — وكلاهما بشهادة البايتات */
  const sniffed = sniffMimeType(file.data);
  const type = [ref.mimeType, file.mimeType].find((t) => INLINE_TYPES.has(t) && signatureMatches(t, file.data))
    ?? (sniffed && INLINE_TYPES.has(sniffed) ? sniffed : null);
  if (!type) {
    return fail("هذا النوع من الملفات لا يُعرض داخل التطبيق. افتحه في الدرايف", 415);
  }

  return new NextResponse(streamOf(file.data), {
    headers: {
      "content-type": type,
      "content-length": String(file.data.length),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(ref.fileName)}`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
