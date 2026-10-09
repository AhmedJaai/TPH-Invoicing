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
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") return "image/heic";
  return null;
}

/** البايتات الأولى تطابق النوع المعلَن. */
export function signatureMatches(mimeType: string, data: Uint8Array): boolean {
  const sniffed = sniffMimeType(data);
  if (!sniffed) return false;
  if (sniffed === "image/heic") return mimeType === "image/heic" || mimeType === "image/heif";
  return sniffed === mimeType;
}
