/**
 * محطّةُ الملفّ الكبير على الخادم: القراءةُ منها، والحذفُ منها، وكنسُ المتروك.
 * السياسةُ (الحدّ · النوع · الرابط المقبول) في `blob-staging-policy.ts`.
 *
 * للخادم وحده — المفتاحُ `BLOB_READ_WRITE_TOKEN` لا يغادره.
 *
 * وطريقان للمصادقة (`blobAuthMode`): المفتاحُ إن وُجد، وإلّا OIDC بـ`BLOB_STORE_ID`.
 * ويُمرَّر للحزمة ما يُعرف صراحةً — المفتاحُ أو معرّفُ المخزن — ولا `token: undefined` أبداً،
 * فلا تختار الحزمةُ طريقاً لمخزنٍ آخر.
 */
import { del, get, list } from "@vercel/blob";
import {
  blobAuthMode, isStagingUrl, MAX_STAGED_BYTES, STAGED_TTL_MS, STAGING_PREFIX, storeIdFromEnv, type BlobAuthMode,
} from "./blob-staging-policy";

/** طريقُ المصادقة اليوم — `null` لا مخزن */
export function blobUploadMode(): BlobAuthMode | null {
  return blobAuthMode(process.env);
}

/**
 * خياراتُ المصادقة لكلّ نداء: `{ token }` بالمفتاح، أو `{ storeId }` بـOIDC (والرمزُ
 * `VERCEL_OIDC_TOKEN` تقرؤه الحزمة من دالّة Vercel). ولا مخزن = `null`.
 */
export function blobAuthOptions(): { token: string } | { storeId: string } | null {
  const mode = blobUploadMode();
  if (mode === "token") return { token: (process.env.BLOB_READ_WRITE_TOKEN ?? "").trim() };
  if (mode === "oidc") return { storeId: (process.env.BLOB_STORE_ID ?? "").trim() };
  return null;
}

/** مخزنُ Blob موصول؟ وغيابُه يعني: لا طريقَ للملفّ الكبير، والشاشةُ تقول حدَّ اليوم */
export function largeUploadsEnabled(): boolean {
  return blobUploadMode() !== null;
}

/** رابطٌ من محطّتنا نحن — بمعرّف المخزن من المفتاح أو من `BLOB_STORE_ID` */
function isOurStagingUrl(url: string): boolean {
  /* معرّفٌ لا يُقرأ = لا نعرف مخزننا، فلا يُجلب شيء — لا «أيُّ مخزنٍ» */
  const store = storeIdFromEnv(process.env);
  return store !== null && isStagingUrl(url, store);
}

/** سببُ تعذّر القراءة من المحطّة — يُقال لصاحب الملفّ بنصّه */
export class StagedFileError extends Error {}

/**
 * بايتاتُ ملفٍّ في المحطّة — بمفتاح الخادم، وبحدٍّ يُفرض وهي تُقرأ لا بعدها.
 * ما ليس من محطّتنا لا يُجلب.
 */
export async function readStaged(url: string): Promise<Buffer> {
  const auth = blobAuthOptions();
  if (!auth) throw new StagedFileError("رفع الملفات الكبيرة غير مفعّل.");
  if (!isOurStagingUrl(url)) throw new StagedFileError("رابط الملف المؤقت غير مقبول.");
  const got = await get(url, { access: "private", useCache: false, ...auth }).catch(() => null);
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
  const auth = blobAuthOptions();
  if (!url || !auth || !isOurStagingUrl(url)) return;
  await del(url, auth).catch(() => undefined);
}

/** المتروكُ في المحطّة أكثرَ من يوم يُحذف — بطاقةٌ لم تُؤرشف ولم تُزل */
export async function sweepStaleStaged(now = Date.now()): Promise<number> {
  const auth = blobAuthOptions();
  if (!auth) return 0;
  const page = await list({ prefix: STAGING_PREFIX, limit: 200, ...auth });
  const stale = page.blobs.filter((b) => now - new Date(b.uploadedAt).getTime() > STAGED_TTL_MS).map((b) => b.url);
  if (stale.length > 0) await del(stale, auth);
  return stale.length;
}
