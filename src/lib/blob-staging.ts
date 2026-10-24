/**
 * محطّةُ الملفّ الكبير على الخادم: القراءةُ منها، والحذفُ منها، وكنسُ المتروك.
 * السياسةُ (الحدّ · النوع · الرابط المقبول) في `blob-staging-policy.ts`.
 *
 * للخادم وحده — المفتاحُ `BLOB_READ_WRITE_TOKEN` لا يغادره.
 */
import { del, get, list } from "@vercel/blob";
import {
  isStagingUrl, MAX_STAGED_BYTES, STAGED_TTL_MS, STAGING_PREFIX, storeIdOf,
} from "./blob-staging-policy";

/** المفتاحُ صراحةً — لا يُترك للحزمة أن تختار طريقاً آخر (OIDC) لمخزنٍ آخر */
const token = () => process.env.BLOB_READ_WRITE_TOKEN;

/** مخزنُ Blob موصول؟ وغيابُه يعني: لا طريقَ للملفّ الكبير، والشاشةُ تقول حدَّ اليوم */
export function largeUploadsEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** رابطٌ من محطّتنا نحن — بمعرّف المخزن من المفتاح */
function isOurStagingUrl(url: string): boolean {
  return isStagingUrl(url, storeIdOf(process.env.BLOB_READ_WRITE_TOKEN));
}

/** سببُ تعذّر القراءة من المحطّة — يُقال لصاحب الملفّ بنصّه */
export class StagedFileError extends Error {}

/**
 * بايتاتُ ملفٍّ في المحطّة — بمفتاح الخادم، وبحدٍّ يُفرض وهي تُقرأ لا بعدها.
 * ما ليس من محطّتنا لا يُجلب.
 */
export async function readStaged(url: string): Promise<Buffer> {
  if (!largeUploadsEnabled()) throw new StagedFileError("رفع الملفات الكبيرة غير مفعّل.");
  if (!isOurStagingUrl(url)) throw new StagedFileError("رابط الملف المؤقت غير مقبول.");
  const got = await get(url, { access: "private", useCache: false, token: token() }).catch(() => null);
  if (!got || got.statusCode !== 200 || !got.stream) {
    throw new StagedFileError("لم يعد الملف المؤقت موجوداً (يُحذف بعد يوم). أعد اختيار الملف من جهازك.");
  }
  if (got.blob.size > MAX_STAGED_BYTES) {
    throw new StagedFileError("الملف أكبر من ٢٥ ميجابايت.");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = got.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_STAGED_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new StagedFileError("الملف أكبر من ٢٥ ميجابايت.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** يحذف ملفّاً من المحطّة — وتعذُّرُ الحذف لا يُسقط ما قبله (الكنسُ يلتقطه) */
export async function discardStaged(url: string | undefined): Promise<void> {
  if (!url || !largeUploadsEnabled() || !isOurStagingUrl(url)) return;
  await del(url, { token: token() }).catch(() => undefined);
}

/** المتروكُ في المحطّة أكثرَ من يوم يُحذف — بطاقةٌ لم تُؤرشف ولم تُزل */
export async function sweepStaleStaged(now = Date.now()): Promise<number> {
  if (!largeUploadsEnabled()) return 0;
  const page = await list({ prefix: STAGING_PREFIX, limit: 200, token: token() });
  const stale = page.blobs.filter((b) => now - new Date(b.uploadedAt).getTime() > STAGED_TTL_MS).map((b) => b.url);
  if (stale.length > 0) await del(stale, { token: token() });
  return stale.length;
}
