/**
 * ردُّ «سجّل أنّها سُدّدت» يقول ما نُسب من حوالات الكشف — فيُفكّ بالتراجع.
 */

/** يُقرأ بفحصٍ لا بتحويل نوع. */
export function readDrawn(v: unknown): { paymentId: string; invoiceId: string }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) =>
    x && typeof x === "object" && "paymentId" in x && "invoiceId" in x
      && typeof x.paymentId === "string" && typeof x.invoiceId === "string"
      ? [{ paymentId: x.paymentId, invoiceId: x.invoiceId }]
      : []);
}
