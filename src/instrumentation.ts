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

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as { message?: string; digest?: string; code?: string; stack?: string };
  console.error(JSON.stringify({
    kind: "request-error",
    at: new Date().toISOString(),
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
    digest: e.digest,
    code: e.code,
    message: (e.message ?? String(err)).slice(0, 300),
    stack: e.stack?.split("\n").slice(0, 4).join(" | "),
  }));
};
