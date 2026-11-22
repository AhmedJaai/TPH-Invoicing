/**
 * أعطابُ الخادم تُسجَّل بما يُعرَف به سببُها.
 *
 * كان الخطأ يصل إلى سجلّ Vercel بمعرّفٍ مختصر (`digest`) بلا مسارٍ ولا
 * نوع، فلا يُعرف أيُّ صفحةٍ سقطت ولا لماذا. والسجلّ يُحفَظ ساعةً على
 * خطّة Hobby — فالسطر الواحد يجب أن يكفي وحده.
 *
 * ولا يُسجَّل جسمُ الطلب ولا ترويساته: فيها الكعكة والمبالغ.
 */
import type { Instrumentation } from "next";
import { describeError, logEvent } from "@/lib/log";
import { checkEnv } from "@/lib/env-check";

/**
 * عند إقلاع الخادم: ما نقص أو تعطّل من متغيّرات البيئة يُقال في سطرٍ واحد —
 * **ولا يُمنَع الإقلاع أبداً**. أسماءٌ بلا قيم. انظر `lib/env-check.ts`.
 */
export function register(): void {
  try {
    const problems = checkEnv(process.env);
    if (problems.length === 0) return;
    logEvent("env-check", {
      missing: problems.filter((p) => p.kind === "missing").map((p) => p.name).join(" "),
      malformed: problems.filter((p) => p.kind === "malformed").map((p) => p.name).join(" "),
    }, "warn");
  } catch {
    /* الفحصُ لا يُسقط الإقلاع */
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const digest = (err as { digest?: unknown } | null)?.digest;
  logEvent("request-error", {
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
    digest: typeof digest === "string" ? digest : undefined,
    /* رسالة Drizzle تُلحق `params:` بقيم الإدخال — مبالغ وأسماء — و`describeError` يقصّها */
    ...describeError(err),
  });
  /*
    ويُحفظ في القاعدة — السجلُّ يُحفظ ساعةً. في Node وحده (القاعدةُ لا تُبلَغ من Edge)، وباستيرادٍ
    متأخّر كي لا يجرّ ملفُّ الإقلاع القاعدةَ إلى كلّ بيئة. والحفظُ لا يرمي (`recordServerError`).
  */
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recordServerError } = await import("@/services/server-errors.service");
    await recordServerError({
      source: "REQUEST",
      route: context.routePath,
      method: request.method,
      digest: typeof digest === "string" ? digest : null,
      ...describeError(err),
    });
  } catch {
    /* الحفظُ لا يُسقط الطلب */
  }
};
