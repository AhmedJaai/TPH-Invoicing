import { vatOnNet } from "@/lib/vat";

/**
 * «بكم أبيعه ليصحّ هامشُه؟» — جوابُ «أضعف الهوامش».
 *
 * القائمةُ كانت تقول إنّ الكيكة هامشُها ٤٤٪ ولا تقول ما العمل. والعملُ واحدٌ من اثنين:
 * سعرٌ أعلى أو مكوّناتٌ أرخص — وهذه تجيب عن الأوّل بحسابٍ لا برأي: السعرُ الشامل
 * الضريبة الذي تكون فيه كلفةُ المكوّنات نسبةَ الهدف من الصافي، مقرَّباً إلى الريال صعوداً
 * لأنّ أسعار القائمة ريالاتٌ تامّة. والقرارُ لصاحب المقهى.
 *
 * الحسابُ بالهللات والمِلّي أعداداً صحيحة؛ القسمةُ تُقرَّب صعوداً في كلّ خطوة كي لا
 * يقع السعرُ المقترح دون الهدف بهللة.
 */

/** هامشُ الهدف: كلفةُ المكوّنات ٣٥٪ من سعر البيع بلا ضريبة — المعيارُ الشائع للمقاهي. */
export const TARGET_MARGIN_BP = 6_500;

const ceilDiv = (a: number, b: number) => Math.floor((a + b - 1) / b);

export interface MarginPrice {
  /** متوسّطُ ما بيعت به الحبّة شاملاً الضريبة، قبل خصم الطلب. */
  currentUnitMinor: number;
  /** كلفةُ مكوّنات الحبّة من الوصفة. */
  unitCostMinor: number;
  /** السعرُ الشامل الضريبة الذي يبلغ به الهدف، بريالٍ تامّ. */
  targetUnitMinor: number;
}

/**
 * `null` حين لا يُحسَب: لا كمّيّة، أو لا كلفة، أو هامشُه بالغٌ الهدف أصلاً.
 */
export function priceForMargin(input: {
  salesMinor: number;
  costMinor: number | null;
  quantityMilli: number;
  marginBp: number | null;
  targetBp?: number;
}): MarginPrice | null {
  const target = input.targetBp ?? TARGET_MARGIN_BP;
  if (input.costMinor === null || input.costMinor <= 0 || input.quantityMilli <= 0) return null;
  if (input.marginBp !== null && input.marginBp >= target) return null;
  if (target <= 0 || target >= 10_000) return null;

  const unitCostMinor = ceilDiv(input.costMinor * 1000, input.quantityMilli);
  const currentUnitMinor = Math.round((input.salesMinor * 1000) / input.quantityMilli);
  const netNeeded = ceilDiv(unitCostMinor * 10_000, 10_000 - target);
  const gross = netNeeded + vatOnNet(netNeeded);
  const targetUnitMinor = ceilDiv(gross, 100) * 100;
  if (targetUnitMinor <= currentUnitMinor) return null;
  return { currentUnitMinor, unitCostMinor, targetUnitMinor };
}
