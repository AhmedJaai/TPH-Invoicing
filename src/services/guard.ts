/**
 * حارس الواجهات: الهوية والصلاحية وحدّ الطلبات في خطوة واحدة.
 *
 * كانت كل واجهة تكرّر ثماني أسطر من `try/catch` لترجمة الأخطاء إلى رموز
 * HTTP، وكان الحدّ غائباً أصلاً. فجُمع ذلك هنا: تكرارٌ أقلّ، ونسيانٌ أصعب.
 */
import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError, type CurrentUser } from "@/lib/session";
import { ForbiddenError, type Capability } from "@/lib/permissions";
import { consume, RateLimitedError } from "./rate-limit.service";

export { RateLimitedError };

/**
 * يتحقّق من الهوية والصلاحية ثمّ يعدّ الطلب.
 * يرمي عند المنع؛ والواجهة تترجم بـ`respondTo`.
 */
export async function guard(route: string, capability: Capability): Promise<CurrentUser> {
  const user = await requireUser(capability);
  await consume(route, user.id);
  return user;
}

/** يترجم أخطاء الحراسة المشتركة إلى ردّ، أو `null` إن لم يكن الخطأ منها. */
export function respondTo(e: unknown): NextResponse | null {
  if (e instanceof UnauthenticatedError) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  if (e instanceof RateLimitedError) {
    return NextResponse.json(
      { error: e.message, retryAfterSeconds: e.retryAfterSeconds },
      { status: 429, headers: { "retry-after": String(e.retryAfterSeconds) } },
    );
  }
  return null;
}
