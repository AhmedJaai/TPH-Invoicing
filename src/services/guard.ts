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
import { MonthClosedError } from "./validation.service";
import { AlreadyMatchedError, PaymentTwinError } from "./payment.service";

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
  /* أخطاءُ المال المعروفة تُقال لقارئها بـ409، لا ٥٠٠ صامتة */
  if (e instanceof MonthClosedError || e instanceof AlreadyMatchedError || e instanceof PaymentTwinError) {
    return NextResponse.json({ error: e.message }, { status: 409 });
  }
  if (e instanceof RateLimitedError) {
    return NextResponse.json(
      { error: e.message, retryAfterSeconds: e.retryAfterSeconds },
      { status: 429, headers: { "retry-after": String(e.retryAfterSeconds) } },
    );
  }
  /*
    قيودُ القاعدة تُقال لقارئها — لا ٥٠٠ بجسمٍ فارغ.

    ضغطتان متزامنتان على «أكّد» أو «سدِّد» أو «أنشئه»: الأولى تُكتب،
    والثانية يردّها قيدٌ في القاعدة (فرادة أو حدود التخصيص). والمال سليم،
    لكنّ الشاشة كانت تقول «ردّ الخادم بخطأ (500)» فيُعاد الضغط.
  */
  const code = pgErrorCode(e);
  if (code === "23505") {
    return NextResponse.json({ error: "سُجّل هذا من قبل — ربما من نافذةٍ أخرى. حدّث الصفحة" }, { status: 409 });
  }
  if (code === "23514") {
    return NextResponse.json({ error: "رفضت القاعدة هذه القيمة لأنّها تخالف قيداً ماليّاً — لم يُكتب شيء. حدّث الصفحة" }, { status: 409 });
  }
  if (code === "23503") {
    return NextResponse.json({ error: "سجلٌّ مرتبط غير موجود — ربما حُذف أو لم يُحفظ. حدّث الصفحة" }, { status: 400 });
  }
  if (code === "22003") {
    return NextResponse.json({ error: "رقمٌ أكبر من المعقول — راجع الأصفار" }, { status: 400 });
  }
  return null;
}

/** رمز خطأ PostgreSQL — على الخطأ نفسه أو على سببه (Drizzle يلفّه). */
export function pgErrorCode(e: unknown): string | undefined {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.code ?? err?.cause?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}
