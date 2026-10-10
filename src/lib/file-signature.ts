/**
 * نوعُ الملفّ من بايتاته الأولى — لا ممّا يقوله المتصفّح.
 *
 * `file.type` والامتدادُ يكتبهما المُرسِل. فملفٌّ أيّاً كان يُعلَن PDF كان يبلغ
 * محلِّل الـPDF ومحوّلَ الصور كما هو. والبصمةُ تُقرأ قبل أيّ محلِّل.
 */

/** النوعُ الذي تدلّ عليه البصمة، أو `null` إن لم تكن من الأنواع المقبولة. */
export function sniffMimeType(data: Uint8Array): string | null {
  const head = Buffer.from(data.subarray(0, 16));
  const hex = head.toString("hex");
  const ascii = (from: number, to: number) => head.subarray(from, to).toString("latin1");
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") return "image/heic";
  /* المواصفةُ تقبل الترويسةَ في أوّل ١٠٢٤ بايتاً — وبعضُ كشوف البنوك تسبقها بسطرٍ أو BOM */
  if (Buffer.from(data.subarray(0, 1024)).includes("%PDF-", 0, "latin1")) return "application/pdf";
  return null;
}

/** البايتات الأولى تطابق النوع المعلَن. */
export function signatureMatches(mimeType: string, data: Uint8Array): boolean {
  const sniffed = sniffMimeType(data);
  if (!sniffed) return false;
  if (sniffed === "image/heic") return mimeType === "image/heic" || mimeType === "image/heif";
  return sniffed === mimeType;
}

/*
  ── ما ينفكّ إليه الملفّ قبل أن يُفكّ ──

  حدودُ الرفع على الحجم **المضغوط** (٤–٨ ميجابايت). وXLSX أرشيفُ zip: ملفٌّ صغير
  ينفكّ إلى جيجابايتات قبل أن يبلغ القارئُ حدَّ الصفوف. وصورةُ HEIC تُفكّ كلُّها في
  الذاكرة بأبعادها المعلَنة. فيُقرأ الفهرسُ والأبعاد أوّلاً ويُردّ ما لا يُعقل.
  (والفهرسُ يكتبه صاحبُ الملفّ — فهذا يردّ القنبلةَ الجاهزة، لا ملفّاً يكذب فهرسُه.)
*/

/** أقصى ما ينفكّ إليه جدولٌ مرفوع — كشفُ سنةٍ كاملة دون عُشره. */
export const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;
/** وأقصى عدد ملفّاتٍ في الأرشيف — مصنّفٌ بعشرين ورقةً فيه عشرات. */
export const MAX_ZIP_ENTRIES = 2_000;
/** أقصى عدد نقاط صورةٍ تُفتح (١٠٠ ميجابكسل) — كاميرا الجوّال ٤٨. */
export const MAX_IMAGE_PIXELS = 100_000_000;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * مجموعُ الأحجام بعد الفكّ كما يعلنها فهرسُ الأرشيف — أو `null` إن لم يكن zip
 * (CSV أو XLS القديم) أو لم يُقرأ فهرسُه.
 */
export function zipExpansion(data: Uint8Array): { entries: number; uncompressedBytes: number } | null {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return null;
  /* سجلُّ نهاية الفهرس في آخر الملفّ، وقبله تعليقٌ حتى ٦٥ كيلوبايت */
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const declared = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let entries = 0;
  let uncompressedBytes = 0;
  while (entries < declared && offset + 46 <= buf.length && buf.readUInt32LE(offset) === CENTRAL_SIGNATURE) {
    uncompressedBytes += buf.readUInt32LE(offset + 24);
    entries++;
    offset += 46 + buf.readUInt16LE(offset + 28) + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32);
  }
  return { entries, uncompressedBytes };
}

/** سببُ ردّ الأرشيف بالعربيّة، أو `null` إن كان معقولاً (أو ليس أرشيفاً). */
export function zipBombReason(data: Uint8Array): string | null {
  const z = zipExpansion(data);
  if (!z) return null;
  if (z.entries > MAX_ZIP_ENTRIES) return "الملفّ يحمل عدداً غير معقولٍ من الأجزاء — ليس جدولاً يُقرأ. صدّره من جديد";
  if (z.uncompressedBytes > MAX_UNZIPPED_BYTES) {
    return `الملفّ ينفكّ إلى ${Math.round(z.uncompressedBytes / (1024 * 1024))} ميجابايت — أكبر من أن يكون جدولاً يُقرأ. صدّر مدّةً أقصر`;
  }
  return null;
}

/**
 * أبعادُ صورة HEIC/HEIF من صندوق `ispe` — أكبرُ ما يُعلَن (الصورةُ الأساس لا
 * مصغَّرتُها). أو `null` إن لم يوجد: فيُترك الحكمُ للمحوِّل كما كان.
 */
export function heifDimensions(data: Uint8Array): { width: number; height: number } | null {
  const buf = Buffer.from(data.buffer, data.byteOffset, Math.min(data.byteLength, 256 * 1024));
  let best: { width: number; height: number } | null = null;
  let at = buf.indexOf("ispe", 0, "latin1");
  while (at >= 0 && at + 16 <= buf.length) {
    /* بعد الاسم: أربعةُ بايتاتٍ للنسخة والأعلام، ثمّ العرضُ والارتفاع */
    const width = buf.readUInt32BE(at + 8);
    const height = buf.readUInt32BE(at + 12);
    if (!best || width * height > best.width * best.height) best = { width, height };
    at = buf.indexOf("ispe", at + 4, "latin1");
  }
  return best;
}

/** يرمي بسببٍ عربيّ إن أعلنت صورةُ HEIC أبعاداً لا تُفتح. */
export function assertHeifOpenable(data: Uint8Array): void {
  const d = heifDimensions(data);
  if (d && d.width * d.height > MAX_IMAGE_PIXELS) {
    throw new Error(`الصورة أكبر من أن تُفتح (${d.width}×${d.height}) — صوّرها بدقّةٍ أقلّ`);
  }
}
