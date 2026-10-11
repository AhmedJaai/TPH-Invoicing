/**
 * صنفٌ يتكرّر فرقُه — بندٌ في «يحتاج قرارك» بسؤالٍ محدَّد.
 *
 * شهرٌ واحد قد يكون عدّاً مستعجلاً؛ شهران متتاليان فوق الحدّ نمط. والحدُّ بالريال لا
 * بالنسبة: قيس على أشهر المقهى (يونيو–سبتمبر ٢٠٢٦) فكان فرقُ أكثر الأصناف دون مئة
 * ريالٍ في الشهر، وما فوق مئةٍ وخمسين قليلٌ يستحقّ النظر.
 *
 * - **نقصٌ** متكرّر (خرج من الرفّ أكثر ممّا تفسّره الوصفات): «راجِع الوصفة أو سجِّل الهدر».
 *   يُقبَل فيه شاهدُ فودكس للمشتريات — يُقال إنّه شاهد.
 * - **زيادةٌ** متكرّرة (استُهلك أكثر من المتاح): «فاتورةٌ ناقصة؟» — بفواتيرنا وحدها.
 *   فالسالبُ بمشتريات فودكس يقول إنّ الشراءَ لم يُدخَل هناك، لا أكثر.
 */
export const RECURRING_GAP_MINOR = 150_00;
export const RECURRING_GAP_MONTHS = 2;

export interface MonthGap {
  month: string;
  productId: string;
  name: string;
  /** فرقُنا بفواتيرنا — `null` غير معروف. */
  oursMinor: number | null;
  /** فرقُ شاهد فودكس — `null` غير معروف. */
  witnessMinor: number | null;
}

export type RecurringKind = "SHORTAGE" | "OVER_AVAILABLE";

export interface RecurringGap {
  productId: string;
  name: string;
  kind: RecurringKind;
  /** الأشهرُ المتتالية حتى آخر شهرٍ قيس، الأحدثُ أوّلاً. */
  months: string[];
  /** مجموعُ الفرق فيها (موجباً). */
  totalMinor: number;
  /** قام على مشتريات فودكس في شهرٍ منها على الأقلّ. */
  byWitness: boolean;
}

function classify(g: MonthGap): { kind: RecurringKind; minor: number; witness: boolean } | null {
  if (g.oursMinor !== null) {
    if (g.oursMinor >= RECURRING_GAP_MINOR) return { kind: "SHORTAGE", minor: g.oursMinor, witness: false };
    if (g.oursMinor <= -RECURRING_GAP_MINOR) return { kind: "OVER_AVAILABLE", minor: -g.oursMinor, witness: false };
    return null;
  }
  if (g.witnessMinor !== null && g.witnessMinor >= RECURRING_GAP_MINOR) return { kind: "SHORTAGE", minor: g.witnessMinor, witness: true };
  return null;
}

/**
 * الأصنافُ التي تكرّر فرقُها في آخر الأشهر المقيسة تتالياً. `months` أشهرُ القياس مرتَّبةً
 * الأحدثُ أوّلاً؛ والسلسلةُ تبدأ من أحدثها — فرقٌ قديمٌ انقطع ليس نمطاً قائماً.
 */
export function recurringGaps(gaps: readonly MonthGap[], months: readonly string[]): RecurringGap[] {
  const byProduct = new Map<string, MonthGap[]>();
  for (const g of gaps) byProduct.set(g.productId, [...(byProduct.get(g.productId) ?? []), g]);
  const out: RecurringGap[] = [];
  for (const list of byProduct.values()) {
    const byMonth = new Map(list.map((g) => [g.month, g]));
    let kind: RecurringKind | null = null;
    const run: string[] = [];
    let totalMinor = 0;
    let byWitness = false;
    for (const month of months) {
      const g = byMonth.get(month);
      const c = g ? classify(g) : null;
      if (c === null || (kind !== null && c.kind !== kind)) break;
      kind = c.kind;
      run.push(month);
      totalMinor += c.minor;
      byWitness = byWitness || c.witness;
    }
    if (kind !== null && run.length >= RECURRING_GAP_MONTHS) {
      out.push({ productId: list[0].productId, name: list[0].name, kind, months: run, totalMinor, byWitness });
    }
  }
  return out.sort((a, b) => b.totalMinor - a.totalMinor);
}
