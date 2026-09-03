/**
 * حارس المسارات.
 *
 * يمنع الوصول قبل تسجيل الدخول. وهذا الحارس طبقة أولى لا وحيدة —
 * كل واجهة برمجية تفحص صلاحيتها بنفسها أيضاً.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
