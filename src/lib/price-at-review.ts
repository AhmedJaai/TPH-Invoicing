/**
 * «أغلى بـ٨٪ من المعتاد» — مقارنةُ سعر البند لحظةَ المراجعة، والمندوبُ عند الباب.
 *
 * تُحسب في الخادم عند القراءة: سعرُ الوحدة **الفعليّ** (بعد الخصم وتسوية الضريبة —
 * `resolveReadLines`، كما يُقيَّد) مقابل **السعر المعتاد** للصنف عند المورّد نفسه
 * (`price-watch.ts`)، لا آخرَ سطرٍ قُيِّد. كانت تقارن ما قرأه النموذجُ خاماً — سعرَ
 * القائمة قبل الخصم أو الشاملَ للضريبة — بما قُيِّد صافياً، فتقول «ارتفع» عن سعرٍ لم يتغيّر.
 *
 * وما يفسّره غيرُ السعر (الضريبة، أو الكمّيّة والوحدة) يُقال سببُه ولا يُعترض به.
 */
import { normalizeItem } from "./items";
import { resolveReadLines, type ReadLine } from "./line-pricing";
import { movesAtReview, type PriceLine, type PriceMove } from "./price-watch";

export type { PriceMove } from "./price-watch";

/**
 * بنودُ القراءة مقابل تاريخ المورّد. `aliases` صيغٌ أقرّها إنسانٌ أنّها صنفٌ آخر (056)،
 * فيُقارَن البندُ باسمه الذي سيُقيَّد به.
 */
export function priceMovesAtReview(
  lines: readonly ReadLine[],
  subtotalMinor: number | null,
  history: readonly PriceLine[],
  aliases: ReadonlyMap<string, string>,
  todayDay: string,
): PriceMove[] {
  const resolved = resolveReadLines(lines, subtotalMinor).map((l) => {
    const read = normalizeItem(l.description);
    return {
      description: l.description,
      normalized: aliases.get(read) ?? read,
      /* ما لم تُقرأ كمّيّتُه أو تعارض ضربُه لا سعرَ وحدةٍ يُقارَن به */
      unitMinor: l.basis === "QTY_UNREAD" || l.basis === "INCONSISTENT" ? null : l.effectiveUnitMinor,
    };
  });
  return movesAtReview(resolved, history, todayDay);
}

/** رسالةُ اعتراضٍ جاهزة — بما ارتفع فعلاً وحده، لا بما يفسّره الضريبةُ أو الوحدة. */
export function priceObjection(supplierName: string, moves: readonly PriceMove[], riyals: (minor: number) => string, day: (iso: string) => string): string {
  const rises = moves.filter((m) => m.deltaBp > 0 && m.reason === null);
  return [
    `السلام عليكم ${supplierName}،`,
    "",
    "لاحظنا في الفاتورة الأخيرة أسعاراً أعلى من سعركم المعتاد:",
    ...rises.map((m) => `• ${m.description}: ${riyals(m.nowMinor)} (كان ${riyals(m.wasMinor)} في ${day(m.wasDay)})`),
    "",
    "نرجو التوضيح أو تصحيح الفاتورة قبل اعتمادها، شاكرين لكم.",
  ].join("\n");
}
