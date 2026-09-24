/**
 * ما يُشتقّ في ملفّ الفاتورة — دوالّ خالصة يختبرها الاختبار بلا قاعدة.
 */
import { MEDIUM_COVERAGE } from "./provenance";

export interface PreviousPrice {
  unitPriceMinor: number;
  date: Date;
  invoiceNumber: string | null;
  invoiceId?: string;
}

export interface PriceMove {
  previousMinor: number;
  previousDate: Date;
  previousNumber: string | null;
  previousInvoiceId: string | null;
  deltaMinor: number;
  /**
   * النسبةُ بالمئة مقرَّبةً إلى عددٍ صحيح — تُحسَب من الهللات لا من عددٍ
   * عشريّ. و`null` إن كان السابق صفراً: النسبة من صفرٍ مجهولة لا صفر.
   */
  percent: number | null;
  direction: "up" | "down" | "same";
}

/** سعرُ البند اليوم مقابل آخر ما اشتُري به الصنفُ نفسه من المورّد نفسه. */
export function priceMove(currentMinor: number, previous: PreviousPrice): PriceMove {
  const deltaMinor = currentMinor - previous.unitPriceMinor;
  return {
    previousMinor: previous.unitPriceMinor,
    previousDate: previous.date,
    previousNumber: previous.invoiceNumber,
    previousInvoiceId: previous.invoiceId ?? null,
    deltaMinor,
    percent: previous.unitPriceMinor === 0
      ? null
      : Math.round((deltaMinor * 100) / previous.unitPriceMinor),
    direction: deltaMinor > 0 ? "up" : deltaMinor < 0 ? "down" : "same",
  };
}

/**
 * حقولٌ قرأها النموذج بثقةٍ دون الحدّ — تُعرَض ليُراجعها إنسان.
 *
 * الحدّ هو `MEDIUM_COVERAGE` في `provenance.ts`: ما دونه لا يُعدّ
 * مقروءاً بثقة. وما لم تُسجَّل ثقتُه لا يُعدّ ضعيفاً ولا قويّاً — مجهول.
 */
export const LOW_CONFIDENCE = MEDIUM_COVERAGE;

export const FIELD_LABEL: Record<string, string> = {
  amounts: "المبالغ",
  vatNumbers: "الأرقام الضريبيّة",
  invoiceDate: "التاريخ",
  documentKind: "نوع المستند",
  supplierName: "اسم المورّد",
  invoiceNumber: "رقم الفاتورة",
  lineItems: "البنود",
};

export function weakFields(confidence: Record<string, number> | null): string[] {
  if (!confidence) return [];
  return Object.entries(confidence)
    .filter(([, v]) => v < LOW_CONFIDENCE)
    .sort(([, a], [, b]) => a - b)
    .map(([k]) => FIELD_LABEL[k] ?? k);
}

/**
 * «الصافي + الضريبة = الإجمالي؟» بالتسامح نفسه الذي في القاعدة.
 *
 * `null` إن لم يُقرأ أحدُ الطرفين: الفحصُ على مجهولٍ ليس نجاحاً.
 */
export function amountsAddUp(
  subtotalMinor: number | null,
  vatMinor: number | null,
  totalMinor: number,
  toleranceMinor: number,
): boolean | null {
  if (subtotalMinor === null || vatMinor === null) return null;
  return Math.abs(subtotalMinor + vatMinor - totalMinor) <= toleranceMinor;
}

/** رابطُ الفاتورة — موضعٌ واحد يُبنى منه في كلّ شاشةٍ وبحثٍ وتنبيه. */
export function invoiceHref(id: string, anchor?: "tax" | "pay" | "lines"): string {
  return `/purchases/invoices/${encodeURIComponent(id)}${anchor ? `#${anchor}` : ""}`;
}
