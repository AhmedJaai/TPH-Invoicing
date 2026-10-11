/**
 * المشترى مقابل المباع — لكلّ صنف مخزونٍ في نافذة: كم اشتُري، كم بِيع منه، وأين الباقي.
 *
 *   **الفرق غير المفسَّر = افتتاحيّ + مشترى − مستهلَك نظريّاً − هدر مسجَّل − ختاميّ**
 *
 * والتسميةُ أصلُ هذا الملفّ:
 *   - «هدر» لما سُجِّل هدراً وحده. الباقي «فرقٌ غير مفسَّر» — هدرٌ لم يُسجَّل، أو وصفةٌ
 *     أكبر من المكتوب، أو فاتورةٌ ناقصة، أو تسريب. تُعرَض الاحتمالات ولا يُحسَم.
 *   - طرفٌ مجهول يجعل الفرقَ مجهولاً لا صفراً، ويُسمّى ما ينقصه.
 *   - بلا عدٍّ في الطرفين لا فرق: «مشترى أكثر من المباع بكذا» قد يكون مخزوناً على الرفّ.
 *   - فرقٌ سالب (مستهلَكٌ أكثر من المتاح) **خطأُ بياناتٍ لا ربح**.
 *
 * والموجبُ والسالبُ لا يتقاصّان في المجموع (`inventory-foodics.md`).
 */
import type { StoredUnit } from "@/lib/unit-conversion";
import { varianceCostMinor } from "@/lib/inventory/purchases";

export type FlowMissing =
  /** لا بندَ فاتورةٍ رُبط بهذا الصنف قطّ — مشترياتُه لا تُعرَف من فواتيرنا. */
  | "PURCHASES_UNLINKED"
  /** بندٌ مربوطٌ لم تُعرَف كمّيّتُه (عبوةٌ بلا مواصفة، وحدةٌ لا تُحوَّل). */
  | "PURCHASES_UNMEASURED"
  /** ما رُبط من فواتيرنا أقلُّ كثيراً ممّا أُدخل في فودكس — بنودٌ لم تُربَط بعد. */
  | "PURCHASES_BELOW_WITNESS"
  /** لا وصفةَ تصل إلى هذا الصنف — ما بِيع منه لا يُعرَف. */
  | "NO_RECIPE"
  /** وصفتان تذكرانه بعائلتَي وحدة. */
  | "UNIT_CONFLICT"
  | "NO_OPENING_COUNT"
  | "NO_CLOSING_COUNT";

export const FLOW_MISSING_LABEL: Record<FlowMissing, string> = {
  PURCHASES_UNLINKED: "لم يُربَط به بندُ فاتورةٍ — مشترياتُه غير معروفة",
  PURCHASES_UNMEASURED: "بندُ فاتورةٍ مربوطٌ لم تُعرَف كمّيّتُه (مواصفةُ العبوة)",
  PURCHASES_BELOW_WITNESS: "المربوطُ من فواتيرنا أقلُّ كثيراً ممّا أُدخل في فودكس — بنودٌ لم تُربَط",
  NO_RECIPE: "لا وصفةَ تصل إليه — ما بِيع منه غير معروف",
  UNIT_CONFLICT: "وصفتان تذكرانه بوحدتين لا تتحوّلان",
  NO_OPENING_COUNT: "لم يُعَدّ في أوّل الفترة",
  NO_CLOSING_COUNT: "لم يُعَدّ في آخرها",
};

/** ما يُكمِل كلَّ نقص — وجهةٌ واحدة لكلٍّ. */
export const FLOW_MISSING_HREF: Record<FlowMissing, string> = {
  PURCHASES_UNLINKED: "/finance/stock/links",
  PURCHASES_UNMEASURED: "/finance/stock/links",
  PURCHASES_BELOW_WITNESS: "/finance/stock/links",
  NO_RECIPE: "/inventory/recipes",
  UNIT_CONFLICT: "/inventory/recipes",
  NO_OPENING_COUNT: "/inventory",
  NO_CLOSING_COUNT: "/inventory",
};

/**
 * دون هذه النسبة من مشتريات فودكس لا تُعدّ مشترياتُنا المربوطة كاملة (بنقاط الأساس).
 * فودكس هنا شاهدٌ على **اكتمال الربط** لا مصدرٌ للرقم: بنٌّ رُبط منه ٢١ كيلو وأُدخل في
 * فودكس ١٣٥ يُنتج «استُهلك أكثر من المتاح بمئة كيلو» — وهو نقصُ ربطٍ لا واقعة.
 */
export const WITNESS_COMPLETENESS_BP = 8_000;

export type CostBasis = "PERIOD_PURCHASES" | "LAST_INVOICE" | "CATALOG";

export const COST_BASIS_LABEL: Record<CostBasis, string> = {
  PERIOD_PURCHASES: "متوسّطُ شراء الفترة",
  LAST_INVOICE: "آخرُ فاتورةٍ قبلها",
  CATALOG: "كلفةُ الكتالوج (تقدير)",
};

export interface FlowItemInput {
  productId: string;
  name: string;
  baseUnit: StoredUnit;
  /** مشترياتُ النافذة المعروفةُ الكمّيّة من فواتيرنا، بالمِلّي المعياريّ وقيمتُها. */
  purchasedMilli: number;
  purchasedMinor: number;
  /** بنودٌ مربوطةٌ بالصنف لم تُعرَف كمّيّتُها. */
  unmeasuredLines: number;
  unmeasuredMinor: number;
  /** أرُبط بالصنف بندُ فاتورةٍ يوماً؟ — بدونه «صفرُ مشتريات» دعوى بلا دليل. */
  everLinked: boolean;
  /** الاستهلاكُ النظريّ ومكوّناتُه — `null` لا وصفةَ تصل إليه. */
  consumed: { milli: number; salesMilli: number; staffMilli: number; refundsMilli: number } | null;
  unitConflict: boolean;
  wasteMilli: number;
  openingMilli: number | null;
  closingMilli: number | null;
  /** معدَّلُ الكلفة بمِلّي‑الهللة لوحدة الأساس وأساسُه — `null` لا كلفةَ معروفة. */
  rateMilliMinor: number | null;
  costBasis: CostBasis | null;
  /** شاهدُ فودكس: صرفُه الصافي (طلباتٌ − مرتجَع) وهدرُه ومشترياتُه — `null` لم يُقرأ. */
  witnessConsumedMilli: number | null;
  witnessWasteMilli: number | null;
  witnessPurchasedMilli: number | null;
}

export interface FlowItem extends FlowItemInput {
  /** `null` المشترى غير معروف. */
  purchasedKnownMilli: number | null;
  consumedMinor: number | null;
  staffMinor: number | null;
  wasteMinor: number | null;
  /** مشترى − مستهلَك − هدر، حيث عُرفت الثلاثة — بلا عدّ: مخزونٌ أو فاقد لا يُفصَل. */
  surplusMilli: number | null;
  surplusMinor: number | null;
  /** `null` لا يُعرَف — والأسبابُ في `missing`. */
  unexplainedMilli: number | null;
  unexplainedMinor: number | null;
  missing: FlowMissing[];
  /** الفرقُ نفسُه محسوباً بمشتريات فودكس بدل فواتيرنا — شاهدٌ يُعرَض باسمه. */
  witnessUnexplainedMilli: number | null;
  witnessUnexplainedMinor: number | null;
}

export function buildFlowItem(i: FlowItemInput): FlowItem {
  const missing: FlowMissing[] = [];
  let purchasedKnownMilli: number | null = i.purchasedMilli;
  if (i.unmeasuredLines > 0) { purchasedKnownMilli = null; missing.push("PURCHASES_UNMEASURED"); }
  else if (!i.everLinked) { purchasedKnownMilli = null; missing.push("PURCHASES_UNLINKED"); }
  else if (i.witnessPurchasedMilli !== null && i.witnessPurchasedMilli > 0
    && i.purchasedMilli * 10_000 < i.witnessPurchasedMilli * WITNESS_COMPLETENESS_BP) {
    purchasedKnownMilli = null;
    missing.push("PURCHASES_BELOW_WITNESS");
  }

  let consumedMilli: number | null = i.consumed?.milli ?? null;
  if (i.unitConflict) { consumedMilli = null; missing.push("UNIT_CONFLICT"); }
  else if (i.consumed === null) missing.push("NO_RECIPE");

  const cost = (milli: number | null) => varianceCostMinor(milli, i.rateMilliMinor, i.baseUnit);

  const surplusMilli = purchasedKnownMilli !== null && consumedMilli !== null
    ? purchasedKnownMilli - consumedMilli - i.wasteMilli : null;

  if (i.openingMilli === null) missing.push("NO_OPENING_COUNT");
  if (i.closingMilli === null) missing.push("NO_CLOSING_COUNT");

  const unexplainedMilli = surplusMilli !== null && i.openingMilli !== null && i.closingMilli !== null
    ? i.openingMilli + surplusMilli - i.closingMilli : null;

  /* الفرقُ نفسُه بمشتريات فودكس — يُعرَض دائماً باسمه بجانب فرقنا، ويسدّ ما لم يُربَط */
  const witnessUnexplainedMilli = i.witnessPurchasedMilli !== null && consumedMilli !== null && i.openingMilli !== null && i.closingMilli !== null
    ? i.openingMilli + i.witnessPurchasedMilli - consumedMilli - i.wasteMilli - i.closingMilli : null;

  return {
    ...i,
    purchasedKnownMilli,
    consumedMinor: cost(consumedMilli),
    staffMinor: consumedMilli === null ? null : cost(i.consumed?.staffMilli ?? 0),
    wasteMinor: cost(i.wasteMilli),
    surplusMilli,
    surplusMinor: cost(surplusMilli),
    unexplainedMilli,
    unexplainedMinor: cost(unexplainedMilli),
    missing,
    witnessUnexplainedMilli,
    witnessUnexplainedMinor: cost(witnessUnexplainedMilli),
  };
}

export interface FlowTotals {
  items: number;
  /** أصنافٌ عُرف فرقُها. */
  measured: number;
  /** قيمةُ ما اشتُري ودخل الحساب (مربوطٌ معروفُ الكمّيّة). */
  purchasedMinor: number;
  /** الاستهلاكُ النظريّ مقوَّماً — `null` لا صنفَ عُرف استهلاكُه وكلفتُه. */
  consumedMinor: number | null;
  /** منه مشروباتُ الموظّفين: استهلاكٌ بلا إيراد. */
  staffMinor: number | null;
  wasteMinor: number;
  /** النقصُ (فرقٌ موجب) والزيادةُ (سالب) لا يتقاصّان. `null` لا صنفَ مقيس. */
  shortageMinor: number | null;
  overageMinor: number | null;
  /** أصنافٌ عُرف فرقُها كمّيّةً ولم تُعرَف كلفتُها. */
  unpriced: number;
  /** مشترى − مباع − هدر لما لا عدَّ له: مخزونٌ أو فاقد. */
  surplusNoCountMinor: number | null;
  /** النقصُ بمشتريات فودكس لما لم تُعرَف مشترياتُنا — شاهد. `null` لا صنفَ. */
  witnessShortageMinor: number | null;
  witnessMeasured: number;
  /** أصنافٌ استهلاكُها النظريّ معروفٌ ولا كلفةَ لها — تنقص من `consumedMinor`. */
  consumedUnpriced: number;
}

export function totalFlow(items: readonly FlowItem[]): FlowTotals {
  const measured = items.filter((x) => x.unexplainedMilli !== null);
  const priced = measured.filter((x) => x.unexplainedMinor !== null);
  const sum = (xs: readonly (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
  const consumedKnown = items.filter((x) => x.consumedMinor !== null);
  const noCount = items.filter((x) => x.unexplainedMilli === null && x.surplusMinor !== null);
  /* سالبُ الشاهد ليس فرقاً: شراءٌ لم يُدخَل في فودكس. فيُعدّ موجبُه وحده */
  const byWitness = items.filter((x) => x.unexplainedMilli === null && x.witnessUnexplainedMinor !== null && x.witnessUnexplainedMinor > 0);
  return {
    items: items.length,
    measured: measured.length,
    purchasedMinor: sum(items.map((x) => (x.purchasedKnownMilli === null ? 0 : x.purchasedMinor))),
    consumedMinor: consumedKnown.length === 0 ? null : sum(consumedKnown.map((x) => x.consumedMinor)),
    staffMinor: consumedKnown.length === 0 ? null : sum(consumedKnown.map((x) => x.staffMinor)),
    wasteMinor: sum(items.map((x) => x.wasteMinor)),
    shortageMinor: priced.length === 0 ? null : sum(priced.map((x) => Math.max(0, x.unexplainedMinor ?? 0))),
    overageMinor: priced.length === 0 ? null : sum(priced.map((x) => Math.min(0, x.unexplainedMinor ?? 0))),
    unpriced: measured.length - priced.length,
    surplusNoCountMinor: noCount.length === 0 ? null : sum(noCount.map((x) => x.surplusMinor)),
    witnessShortageMinor: byWitness.length === 0 ? null : sum(byWitness.map((x) => x.witnessUnexplainedMinor)),
    witnessMeasured: byWitness.length,
    consumedUnpriced: items.filter((x) => x.consumed !== null && !x.unitConflict && x.consumedMinor === null && x.consumed.milli !== 0).length,
  };
}

/** نسبةٌ بنقاط الأساس — `null` بلا مقام. */
export function ratioBp(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 10_000) / whole) : null;
}
