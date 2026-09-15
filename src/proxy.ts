/**
 * حارس المسارات — `proxy` في Next 16 (كان `middleware` وأُهمل اسمه).
 *
 * يمنع الوصول قبل تسجيل الدخول. وهذا الحارس طبقة أولى لا وحيدة —
 * كل واجهة برمجية تفحص صلاحيتها بنفسها أيضاً.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { previewAllowed } from "@/lib/preview-mode";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/health"];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ACCEPTED_BODIES = /^(application\/json|multipart\/form-data|application\/x-www-form-urlencoded)/i;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
    ── طلبٌ كاتب من موقعٍ آخر لا يُقبل ──

    كانت الواجهات تقبل POST بـ«text/plain» من أصلٍ آخر مع الكعكة، ولا
    يحمي إلّا SameSite=Lax — طلبٌ «بسيط» بلا فحصٍ مسبق يكفيه نموذج HTML
    واحد لو ضعف Lax يوماً. فالأصلُ المختلف يُردّ، والجسم بغير نوعٍ نعرفه
    يُردّ. (والنداء بلا Origin — نصٌّ محلّيّ — يمرّ: غيابُ الترويسة غيرُ اختلافها.)
    وAuth.js يحرس مساراته بنفسه برمز CSRF.
  */
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth") && WRITE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      let sameHost = false;
      try { sameHost = new URL(origin).host === request.nextUrl.host; } catch { sameHost = false; }
      if (!sameHost) {
        return NextResponse.json({ error: "طلبٌ من موقعٍ آخر — رُفض" }, { status: 403 });
      }
    }
    const type = request.headers.get("content-type");
    if (type && !ACCEPTED_BODIES.test(type)) {
      return NextResponse.json({ error: "نوع الطلب غير مقبول" }, { status: 415 });
    }
  }

  // وضع التجربة يفتح الأبواب عمداً، ولا يعمل في الإنتاج — راجع lib/preview-mode.ts
  if (previewAllowed(process.env)) return NextResponse.next();

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // وجود كعكة الجلسة فحص مبدئي فقط؛ التحقق الفعلي في الخادم.
  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  if (!hasSession) {
    // واجهات البرمجة تردّ 401 بصيغة JSON — تحويلها إلى صفحة HTML
    // يجعل fetch يتلقّى صفحة دخول بدل رسالة خطأ مفهومة.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|svg|woff2)$).*)"],
};
