/**
 * الرسم البنكيّ داخل الدفعة.
 *
 * فاتورةٌ بخمسة آلاف وخصمٌ بخمسة آلاف وعشرين ليست «مبلغاً لا يوافق»:
 * هي الفاتورة ورسمُ تحويلها. وتسميتها اختلافاً تُبقيها معلّقةً إلى
 * الأبد، وصاحب العمل يعرف أنّها مدفوعة.
 *
 * والحدّ لا يُترَك مفتوحاً: الرسم البنكيّ في السعودية عشراتُ الريالات
 * لا مئاتها. فما جاوز الحدّ فرقٌ حقيقيّ يُحقَّق فيه، لا رسمٌ يُفترَض.
 * والتسامح الذي يبتلع كل فرق يُخفي أخطاءً بدل أن يُصلحها.
 */

/** أقصى رسمٍ يُقبَل افتراضه: خمسة وسبعون ريالاً. */
export const MAX_FEE_MINOR = 75_00;

/**
 * ونسبةً كذلك — كي لا يُفترَض رسمٌ بخمسة وسبعين على فاتورة بمئة.
 * الرسم على دفعةٍ صغيرة يكون أصغر.
 */
export const MAX_FEE_RATIO = 0.02;

export interface FeeSplit {
  /** ما يُخصَّص على الفواتير. */
  allocatedMinor: number;
  /** ما يُقيَّد رسماً بنكياً. */
  feeMinor: number;
  reason: string;
}

/**
 * يفصل الرسم عن المخصَّص.
 *
 * والشرط أن يكون الخصم **أكبر** من الفاتورة: الرسم يُضاف لا يُطرَح.
 * ولو نقص الخصم عن الفاتورة فذلك سدادٌ جزئيّ لا رسم — وهما حالان
 * مختلفان، وخلطهما يجعل النظام يخترع رسماً سالباً.
 */
export function splitBankFee(
  paidMinor: number,
  invoiceTotalMinor: number,
): FeeSplit | null {
  if (invoiceTotalMinor <= 0) return null;

  const excess = paidMinor - invoiceTotalMinor;
  if (excess <= 0) return null;

  const cap = Math.min(MAX_FEE_MINOR, Math.round(invoiceTotalMinor * MAX_FEE_RATIO));
  if (excess > cap) return null;

  return {
    allocatedMinor: invoiceTotalMinor,
    feeMinor: excess,
    reason:
      `الخصم يزيد ${(excess / 100).toFixed(2)} عن الفاتورة — ` +
      "وهو في حدّ رسم التحويل، فيُقيَّد رسماً لا اختلافاً",
  };
}

/**
 * ويفصله عن مجموعة فواتير كذلك.
 *
 * والحدّ يُحسب على المجموع لا على كل فاتورة: الرسم واحدٌ للحوالة لا
 * لكل بندٍ فيها.
 */
export function splitGroupFee(
  paidMinor: number,
  invoiceIds: readonly { id: string; outstandingMinor: number }[],
): { allocations: { invoiceId: string; amountMinor: number }[]; feeMinor: number } | null {
  const sum = invoiceIds.reduce((s, i) => s + i.outstandingMinor, 0);
  const split = splitBankFee(paidMinor, sum);
  if (!split) return null;

  return {
    allocations: invoiceIds.map((i) => ({ invoiceId: i.id, amountMinor: i.outstandingMinor })),
    feeMinor: split.feeMinor,
  };
}
