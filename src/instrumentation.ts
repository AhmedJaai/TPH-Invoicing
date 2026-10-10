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
};
