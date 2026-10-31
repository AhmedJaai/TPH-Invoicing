/**
 * رمز خطأ PostgreSQL — على الخطأ نفسه أو على سببه (Drizzle يلفّه).
 *
 * ملفٌّ بلا تبعيّة: كان في `services/guard.ts`، فكلُّ خدمةٍ تسأل عن رمز خطأ تجرّ معه الجلسةَ
 * وnext-auth — وسقط بها اختبارُ قاعدة الرواتب في CI («Cannot find module next/server»).
 */
export function pgErrorCode(e: unknown): string | undefined {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.code ?? err?.cause?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}
