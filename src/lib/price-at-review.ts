/**
 * «أغلى بـ٨٪ من آخر مرّة» — مقارنةُ سعر البند لحظةَ المراجعة، والمندوبُ عند الباب.
 *
 * ملفُّ الفاتورة يقارن البنودَ بعد القيد، وتنبيهُ ارتفاع الأسعار يأتي لاحقاً في
 * الطابور. وهذه تُحسب في الخادم عند القراءة: سعرُ الوحدة المقروء مقابل آخر سعرٍ
 * قُيِّد **للصنف نفسه عند المورّد نفسه** (الاسمُ وحده لا يعرّف صنفاً). أعدادٌ صحيحة
 * بالهللات، والنسبةُ بنقاط الأساس. وما لم يُقرأ سعرُه أو لا سابقةَ له لا يُذكَر —
 * لا «تغيّر 0٪» عن مجهول. ودون ٣٪ تقريبٌ لا حركة، كما في «الأصناف والأسعار».
 */
import { normalizeItem } from "./items";
import { parseRiyals } from "./money";

/** دون هذا تقريبٌ لا حركة — بنقاط الأساس (٣٪). */
export const PRICE_MOVE_FLOOR_BP = 300;

export interface LastPrice {
  unitPriceMinor: number;
  /** YYYY-MM-DD */
  day: string;
}

export interface PriceMove {
  description: string;
  nowMinor: number;
  wasMinor: number;
  wasDay: string;
  /** موجبٌ ارتفاع وسالبٌ انخفاض — بنقاط الأساس، مقرَّبةً إلى أقرب نقطة. */
  deltaBp: number;
}

export function priceMovesAtReview(
  lines: readonly { description?: string; unitPrice?: string }[],
  lastByItem: ReadonlyMap<string, LastPrice>,
): PriceMove[] {
  const out: PriceMove[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const description = (line.description ?? "").trim();
    const key = normalizeItem(description);
    if (!key || seen.has(key)) continue;
    const nowMinor = parseRiyals(line.unitPrice ?? "");
    const last = lastByItem.get(key);
    /* سعرٌ لم يُقرأ، أو صفر، أو لا سابقةَ له: لا مقارنةَ تُقال */
    if (nowMinor === null || nowMinor <= 0 || !last || last.unitPriceMinor <= 0) continue;
    const deltaBp = Math.round(((nowMinor - last.unitPriceMinor) * 10_000) / last.unitPriceMinor);
    if (Math.abs(deltaBp) < PRICE_MOVE_FLOOR_BP) continue;
    seen.add(key);
    out.push({ description, nowMinor, wasMinor: last.unitPriceMinor, wasDay: last.day, deltaBp });
  }
  /* الأثقلُ ارتفاعاً أوّلاً — هو ما يُعترَض عليه */
  return out.sort((a, b) => b.deltaBp - a.deltaBp);
}

/** مفاتيحُ الأصناف في البنود — يُسأل بها الخادمُ عن آخر أسعارها. */
export function itemKeys(lines: readonly { description?: string }[]): string[] {
  return [...new Set(lines.map((l) => normalizeItem((l.description ?? "").trim())).filter(Boolean))];
}

/** رسالةُ اعتراضٍ جاهزة — بالبنود التي ارتفعت وحدها، بسعرَيها. */
export function priceObjection(supplierName: string, moves: readonly PriceMove[], riyals: (minor: number) => string, day: (iso: string) => string): string {
  const rises = moves.filter((m) => m.deltaBp > 0);
  return [
    `السلام عليكم ${supplierName}،`,
    "",
    "لاحظنا في الفاتورة الأخيرة أسعاراً أعلى من آخر توريد:",
    ...rises.map((m) => `• ${m.description}: ${riyals(m.nowMinor)} (كان ${riyals(m.wasMinor)} في ${day(m.wasDay)})`),
    "",
    "نرجو التوضيح أو تصحيح الفاتورة قبل اعتمادها، شاكرين لكم.",
  ].join("\n");
}
