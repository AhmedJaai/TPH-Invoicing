/**
 * رقمان لمائدة التفاوض — من قيودٍ قائمة، بلا تقدير.
 *
 * (١) **كم يوماً تدفع بعد الفاتورة** في المقهى كلِّه، مرجَّحاً بالمبلغ: فاتورةُ عشرة
 *     آلافٍ دُفعت بعد شهرين تزن أكثر من فاتورة مئةٍ دُفعت في يومها.
 * (٢) **حصّةُ أكبر المورّدين من مشترياتك**: مورّدٌ واحد فوق أربعين في المئة خطرُ انقطاعٍ
 *     وورقةُ خصمِ كمّيّةٍ معاً.
 *
 * والعيّنةُ القليلة لا يُبنى عليها رقم: دون خمس فواتير مسدَّدة «غير معروف».
 */

/** أقلُّ عيّنةٍ يُقال عليها متوسّط. */
export const MIN_PAY_SAMPLE = 5;
/** مورّدٌ يحمل أكثر من هذه الحصّة (نقاطُ أساس) يُسمّى «تركّزاً». */
export const DOMINANT_SHARE_BP = 4_000;

export interface PaidInvoice {
  /** أيّامٌ من تاريخ الفاتورة إلى اكتمال سدادها — السالبُ (دُفعت قبلها) يُعدّ صفراً. */
  days: number;
  amountMinor: number;
}

export interface DaysToPay {
  /** `null` العيّنةُ أقلّ من أن يُبنى عليها. */
  weightedDays: number | null;
  sampleCount: number;
}

export function weightedDaysToPay(invoices: readonly PaidInvoice[]): DaysToPay {
  const usable = invoices.filter((i) => Number.isFinite(i.days) && i.amountMinor > 0);
  const total = usable.reduce((s, i) => s + i.amountMinor, 0);
  if (usable.length < MIN_PAY_SAMPLE || total <= 0) return { weightedDays: null, sampleCount: usable.length };
  const weighted = usable.reduce((s, i) => s + Math.max(0, i.days) * i.amountMinor, 0);
  return { weightedDays: Math.round(weighted / total), sampleCount: usable.length };
}

export interface SupplierSpend {
  supplierId: string;
  name: string;
  slug: string;
  minor: number;
}

export interface Concentration {
  totalMinor: number;
  supplierCount: number;
  top: (SupplierSpend & { shareBp: number })[];
  /** حصّةُ الثلاثة الأوائل مجتمعين (نقاطُ أساس). */
  topShareBp: number;
  /** الأوّلُ إن جاوز حدَّ التركّز — وإلّا `null`. */
  dominant: (SupplierSpend & { shareBp: number }) | null;
}

/** `null` حين لا مشتريات في النافذة — لا «تركّزٌ صفر». */
export function concentration(spend: readonly SupplierSpend[]): Concentration | null {
  const positive = spend.filter((s) => s.minor > 0);
  const total = positive.reduce((s, x) => s + x.minor, 0);
  if (total <= 0) return null;
  const top = [...positive]
    .sort((a, b) => b.minor - a.minor || a.supplierId.localeCompare(b.supplierId))
    .slice(0, 3)
    .map((s) => ({ ...s, shareBp: Math.round((s.minor * 10_000) / total) }));
  const topMinor = top.reduce((s, x) => s + x.minor, 0);
  return {
    totalMinor: total,
    supplierCount: positive.length,
    top,
    topShareBp: Math.round((topMinor * 10_000) / total),
    dominant: top[0] && top[0].shareBp > DOMINANT_SHARE_BP ? top[0] : null,
  };
}
