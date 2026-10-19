/**
 * صورةُ الفريق المنتظِرة بايتاتٍ — تفتحها شاشةُ الرفع لتُقرأ وتُراجَع وتُؤرشَف.
 *
 *   GET ?id=… → الملفّ نفسُه
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { loadCaptureFile } from "@/services/capture.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await guard("capture-file", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return NextResponse.json({ error: "معرّف الصورة غير صالح" }, { status: 400 });
  const file = await loadCaptureFile(id);
  if (!file) return NextResponse.json({ error: "هذه الصورة لم تعد تنتظر: اعتُمدت أو رُفضت. حدّث الصفحة" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "content-type": file.mimeType,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "x-capture-sender": encodeURIComponent(file.sender),
    },
  });
}
