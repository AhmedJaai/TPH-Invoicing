/**
 * حارس الواجهات: الهوية والصلاحية وحدّ الطلبات في خطوة واحدة.
 *
 * كانت كل واجهة تكرّر ثماني أسطر من `try/catch` لترجمة الأخطاء إلى رموز
 * HTTP، وكان الحدّ غائباً أصلاً. فجُمع ذلك هنا: تكرارٌ أقلّ، ونسيانٌ أصعب.
 */
import "@/lib/zod-ar";
import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError, type CurrentUser } from "@/lib/session";
import { ForbiddenError, type Capability } from "@/lib/permissions";
import { describeError, logEvent } from "@/lib/log";
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
  /*
    ومؤثِّراتُنا تقول سببها بالعربيّة («هذا يقع في أسبوعٍ جردُه مقفَل — أعِد فتح
    الجرد أوّلاً» · «صافي الدفعة أقلّ ممّا خُصّص منها»). فيُقال نصُّها — لا جملةٌ
    عامّة عن «قيدٍ ماليّ» لا تقول ما العمل. وقيدُ CHECK بلا نصّ يبقى على العامّة.
  */
  const own = ownDatabaseMessage(e);
  if ((code === "23514" || code === "P0001") && own) {
    return NextResponse.json({ error: own }, { status: 409 });
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

/**
 * خاتمةُ المسار: ما نعرفه يُقال بنصّه، وما لا نعرفه عطبُ خادمٍ برقم مرجع.
 *
 * كانت عشرةُ مسارات تختم بـ`{ error: (e as Error).message }` و400 لكلّ خطأ. وخطأ
 * Drizzle يحمل نصَّ الاستعلام وقيمَه، وخطأ `pg` يحمل اسمَ المضيف — فيُعرَض على
 * الشاشة SQL وأسماءُ جداول، ويُسمّى عطبُ الخادم «خطأَ إدخال». فرسائلُنا (بالعربيّة،
 * يرميها الخادمُ عمداً) تبقى كما هي بـ400، وغيرُها 500 برسالةٍ عامّة، والتفصيلُ
 * في سجلّ الخادم تحت المرجع نفسه.
 */
export function failWith(e: unknown, route: string): NextResponse {
  const mapped = respondTo(e);
  if (mapped) return mapped;
  const own = ownMessage(e);
  if (own) return NextResponse.json({ error: own }, { status: 400 });
  const ref = crypto.randomUUID().slice(0, 8);
  /* سطرٌ واحد بالمرجع نفسه — بلا `params:`: قيمُ الإدخال (مبالغُ وأسماء) لا تدخل السجلّ */
  logEvent("route-error", { route, ref, ...describeError(e) });
  return NextResponse.json(
    { error: `عطبٌ في الخادم — أعد المحاولة، وإن تكرّر فاذكر المرجع ${ref}`, ref },
    { status: 500 },
  );
}

/** رسالةٌ كتبناها نحن: عربيّة، وليست استعلاماً فاشلاً ولا خطأً من القاعدة. */
function ownMessage(e: unknown): string | null {
  if (!(e instanceof Error) || pgErrorCode(e)) return null;
  const m = e.message;
  if (m.startsWith("Failed query") || !/[\u0600-\u06FF]/.test(m)) return null;
  return m.slice(0, 300);
}

/** رمز خطأ PostgreSQL — على الخطأ نفسه أو على سببه (Drizzle يلفّه). */
export function pgErrorCode(e: unknown): string | undefined {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.code ?? err?.cause?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

/** نصُّ ما رفعه مؤثِّرٌ منّا — بالعربيّة وحدها؛ ورسالةُ Postgres الإنجليزيّة لا تُعرَض. */
function ownDatabaseMessage(e: unknown): string | null {
  const err = e as { message?: unknown; cause?: { message?: unknown } } | null;
  for (const m of [err?.cause?.message, err?.message]) {
    if (typeof m === "string" && !m.startsWith("Failed query") && /[\u0600-\u06FF]/.test(m)) return m.slice(0, 300);
  }
  return null;
}
