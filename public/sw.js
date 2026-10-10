/*
 * عاملُ الخدمة — مكتوبٌ باليد، بلا مكتبة، ولشيئين لا ثالث لهما:
 *
 * ١. **بلا شبكة:** التطبيقُ المثبَّت كان يفتح صفحةَ خطأ المتصفّح الرماديّة حين
 *    تضعف الشبكة في المخزن. فيُعرَض بدلها «أنت بلا اتّصال» بالعربيّة وزرُّ إعادة.
 * ٢. **هدفُ المشاركة:** «شارِك إلى ذا بوبليك هاوس» من واتساب — الملفُّ يُحفَظ
 *    هنا لحظةً ثمّ تُفتح صفحةُ الرفع فتقرؤه (`src/lib/shared-inbox.ts`).
 *
 * **ولا يخزّن شيئاً من التطبيق:** لا صفحةً ولا ردَّ `/api` ولا ملفّاً ثابتاً. كلُّ
 * طلبٍ يذهب إلى الشبكة كما كان، ولا يُعترَض إلّا التنقّلُ (ليُعرَف أنّه فشل)
 * ومسارُ المشاركة. فلا رقمَ ماليّاً قديماً يُعرَض من خزين، ولا نشرٌ جديد يعلق
 * خلف نسخةٍ قديمة. وصفحةُ «بلا اتّصال» نصٌّ في هذا الملفّ نفسِه لا ملفٌّ يُجلَب:
 * كلُّ مسارٍ خلف الدخول، وجلبُها بلا جلسةٍ كان سيخزّن صفحةَ الدخول مكانها.
 */
const SHARE_CACHE = "tph-share";
const SHARE_PATH = "/share-target";
const MAX_SHARED = 20;

const OFFLINE_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f6f4ef">
<title>بلا اتّصال · ذا بوبليك هاوس</title>
<style>
  :root { color-scheme: light dark; --surface: #f6f4ef; --raised: #ffffff; --ink: #1b1a17; --soft: #57534b; --line: #e6e1d7; --accent: #5a5444; --accent-ink: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --surface: #0e0d0b; --raised: #1a1815; --ink: #efeae0; --soft: #cdc6b8; --line: #2b2823; --accent: #cbc09a; --accent-ink: #211e17; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--surface); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.7; }
  main { max-width: 26rem; width: 100%; text-align: center; background: var(--raised); border: 1px solid var(--line); border-radius: 16px; padding: 40px 24px; }
  h1 { margin: 0 0 8px; font-size: 1.15rem; }
  p { margin: 0 0 8px; font-size: 0.9rem; color: var(--soft); }
  button { margin-top: 16px; min-height: 44px; padding: 0 20px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 700; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>أنت بلا اتّصال</h1>
  <p>لم يصل الطلبُ إلى الخادم — فلم يُحفَظ شيءٌ ولم يضِع شيء.</p>
  <p>ما صحّحتَه في صفحة الرفع محفوظٌ في هذا الجهاز ويعود حين تفتحها.</p>
  <button type="button" onclick="location.reload()">أعد المحاولة</button>
</main>
<script>addEventListener("online", function () { location.reload(); });</script>
</body>
</html>`;

function offlinePage() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function redirectTo(path) {
  return Response.redirect(new URL(path, self.location.origin).href, 303);
}

/** ملفّاتُ المشاركة تُحفَظ لحظةً ثمّ تُفتح صفحةُ الرفع — وهي التي تقرؤها وتمحوها. */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((f) => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
    const cache = await caches.open(SHARE_CACHE);
    const stamp = Date.now();
    let stored = 0;
    for (const file of files.slice(0, MAX_SHARED)) {
      await cache.put(
        new URL(`/__shared/${stamp}-${stored}`, self.location.origin).href,
        new Response(file, {
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name || "shared"),
            "x-shared-at": String(stamp),
          },
        }),
      );
      stored++;
    }
    return redirectTo(`/upload?shared=${stored}`);
  } catch {
    return redirectTo("/upload?shared=0");
  }
}

self.addEventListener("install", () => {
  /* لا خزينَ يُبنى — النسخةُ الجديدة تعمل فوراً */
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === "POST" && url.pathname === SHARE_PATH) {
    event.respondWith(receiveShare(request));
    return;
  }

  /* التنقّلُ وحده: شبكةٌ أوّلاً ودائماً، وصفحةُ «بلا اتّصال» حين لا يصل الطلب */
  if (request.method === "GET" && request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => offlinePage()));
  }
});
