/**
 * الملفّ الكبير: محطّةٌ مؤقّتة في Vercel Blob — سياستُها خالصةً تُختبَر.
 *
 * حدُّ المنصّة لجسم الطلب ٤٫٥ ميجابايت، فما فوق ٣ ميجابايت كان يُردّ «صغّره». فإن
 * وُجد مخزن Blob (`BLOB_READ_WRITE_TOKEN`) رفعه المتصفّحُ إليه مباشرةً، ثمّ قرأه
 * الخادمُ من هناك بمفتاحه، وفحص بصمتَه كما يفحص المرفوعَ عادةً، وحذفه بعد الأرشفة أو
 * الرفض. فهو **محطّةٌ لا أرشيف**: الأرشيفُ الدرايف وحده.
 *
 * ولا مخزن = لا شيء من هذا: الشاشةُ تقول «أكبر من ٣ ميجابايت» كما كانت.
 *
 * للمتصفّح والخادم معاً — لا تستورد حزمة Blob.
 */

/** كلُّ ما يُرفع إلى المحطّة تحت هذا المجلّد — ولا يُقرأ ولا يُحذف غيرُه */
export const STAGING_PREFIX = "staging/";

/** أكبرُ ملفٍّ يُقبل عبر المحطّة */
export const MAX_STAGED_BYTES = 25 * 1024 * 1024;

/** ما يُعدّ في المحطّة متروكاً (بطاقةٌ لم تُؤرشف ولم تُزل) فيُكنَس */
export const STAGED_TTL_MS = 24 * 60 * 60 * 1000;

/** الأنواعُ نفسُها التي تقبلها الأرشفة — PDF وصور */
export const STAGED_TYPES: readonly string[] = [
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif",
];

/** المعرّفُ من مفتاح المخزن (`vercel_blob_rw_<id>_<سرّ>`) — ليُقابَل به مضيفُ الرابط */
export function storeIdOf(token: string | undefined): string | null {
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token ?? "");
  return m ? m[1].toLowerCase() : null;
}

/**
 * رابطٌ من محطّتنا نحن؟ الخادمُ لا يجلب رابطاً أرسله المتصفّح إلّا إن كان مخزنَ Blob،
 * ومخزنَنا (إن عُرف معرّفه)، وتحت `staging/` — فلا يُستعمل الخادم لجلب غيره.
 */
export function isStagingUrl(raw: string, storeId: string | null): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(".blob.vercel-storage.com")) return false;
  if (storeId !== null && host.split(".")[0] !== storeId) return false;
  return url.pathname.startsWith(`/${STAGING_PREFIX}`) && !url.pathname.includes("..");
}

/** اسمٌ في المحطّة لملفٍّ مرفوع: تحت `staging/`، بلا مجلّدات ولا رموز */
export function stagingPathname(fileName: string): string {
  const base = fileName.replace(/[/\\\u0000-\u001f]/g, "_").replace(/\.{2,}/g, "_").slice(-120) || "file";
  return `${STAGING_PREFIX}${base}`;
}

/**
 * حكمُ طلب الرفع قبل أن يُعطى المتصفّحُ إذناً: الاسمُ تحت المحطّة، والنوعُ من المقبول.
 * والحجمُ والنوعُ يُفرضان على الإذن نفسه (`maximumSizeInBytes` · `allowedContentTypes`)
 * فلا يتجاوزهما المتصفّح.
 */
export function stagingTokenDecision(pathname: string, contentType: string | null):
  | { ok: true; allowedContentTypes: string[]; maximumSizeInBytes: number }
  | { ok: false; error: string } {
  if (!pathname.startsWith(STAGING_PREFIX) || pathname.slice(STAGING_PREFIX.length).includes("/") || pathname.includes("..")) {
    return { ok: false, error: "اسم الملف غير مقبول" };
  }
  if (contentType !== null && !STAGED_TYPES.includes(contentType)) {
    return { ok: false, error: `نوع الملف غير مقبول (${contentType}). المقبول ملف PDF أو صورة.` };
  }
  return { ok: true, allowedContentTypes: [...STAGED_TYPES], maximumSizeInBytes: MAX_STAGED_BYTES };
}
