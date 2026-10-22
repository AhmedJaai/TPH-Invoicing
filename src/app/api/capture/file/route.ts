/**
 * صورةُ الفريق المنتظِرة بايتاتٍ — تفتحها شاشةُ الرفع لتُقرأ وتُراجَع وتُؤرشَف.
 *
 *   GET ?id=… → الملفّ نفسُه
 *   GET ?id=…&thumb=1 → مصغّرةٌ للقائمة (JPEG ٣٢٠ بكسلاً)
 *
 * كانت القائمةُ تجلب كلَّ صورةٍ كاملةً لمربّعٍ صغير: ١٠٢ صورة = ٦٣ ميجابايت تمرّ من
 * القاعدة إلى المتصفّح في كلّ زيارة. والمصغّرةُ تُخزَّن ساعةً: بايتاتُ الصورة لا
 * تتغيّر ما دام معرّفُها (تُعتمد فتُفرَّغ، أو تُرفض) — والأصلُ لا يُخزَّن.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { loadCaptureFile } from "@/services/capture.service";
import { MAX_IMAGE_PIXELS } from "@/lib/file-signature";

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
  if (new URL(request.url).searchParams.get("thumb") === "1") {
    const thumb = await thumbnailOf(file.data, file.mimeType);
    if (thumb) {
      return new NextResponse(new Uint8Array(thumb), {
        headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
      });
    }
  }
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

/** مصغّرةٌ للقائمة — أو `null` (PDF، أو صورةٌ لا تُفتح) فيُرسَل الأصل كما كان. */
async function thumbnailOf(data: Buffer, mimeType: string): Promise<Buffer | null> {
  if (!mimeType.startsWith("image/")) return null;
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(data, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch {
    return null;
  }
}
