/**
 * صندوقُ المشاركة — ما شورِك إلى التطبيق المثبَّت (واتساب ← مشاركة ← ذا بوبليك
 * هاوس) يضعه عاملُ الخدمة (`public/sw.js`) في خزينٍ مؤقّت، وصفحةُ الرفع تأخذه
 * من هنا وتمحوه.
 *
 * والخزينُ معبرٌ لا مخزن: يُفرَغ عند أوّل أخذ، وما بقي فيه أكثر من يومٍ (مشاركةٌ
 * لم تُفتح صفحتُها) يُمحى ولا يُقرأ.
 *
 * للمتصفّح وحده.
 */
export const SHARE_CACHE = "tph-share";
const STALE_MS = 24 * 60 * 60 * 1000;

/** اسمُ الملفّ كما حمله العامل — مرمَّزاً، فإن فسد يُعطى اسماً عامّاً بامتداد نوعه. */
export function sharedFileName(header: string | null, type: string): string {
  let name = "";
  try {
    name = decodeURIComponent(header ?? "").trim();
  } catch {
    name = "";
  }
  /* اسمٌ لا مسار — ما بعد آخر فاصل وحده */
  name = name.split(/[\\/]/).pop() ?? "";
  if (name) return name;
  const ext = type === "application/pdf" ? "pdf" : type.startsWith("image/") ? type.slice(6).replace("jpeg", "jpg") : "bin";
  return `مشاركة.${ext}`;
}

export async function takeShared(now: number = Date.now()): Promise<File[]> {
  try {
    if (typeof caches === "undefined") return [];
    if (!(await caches.has(SHARE_CACHE))) return [];
    const cache = await caches.open(SHARE_CACHE);
    const out: File[] = [];
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      await cache.delete(request);
      if (!response) continue;
      const at = Number(response.headers.get("x-shared-at"));
      if (!Number.isFinite(at) || now - at > STALE_MS) continue;
      const type = response.headers.get("content-type") ?? "";
      const blob = await response.blob();
      out.push(new File([blob], sharedFileName(response.headers.get("x-file-name"), type), { type: type === "application/octet-stream" ? "" : type }));
    }
    return out;
  } catch {
    return [];
  }
}
