/**
 * التغطية — «كم من الفترة أستطيع أن أحسبه، وكم لا أستطيع؟»
 *
 * ── لماذا تُحسَب قبل النتيجة ──
 *
 * رقمُ فرقٍ يبدو دقيقاً («‑٢٬١٠٠ ريال») وقد سقط منه ثلثُ المبيعات
 * صامتاً **أسوأ من ألّا يوجد رقم**: الأوّل يُتَّخَذ عليه قرارٌ خاطئ،
 * والثاني يدفع إلى إكمال البيانات. وهذا هو الدرسُ نفسه الذي أنتج
 * بوّابةَ الإنتاج: «لم يُفحَص» يمنع كما يمنع «فشل».
 *
 * فالتقريرُ يُعلَن **جزئياً** ومعه ما استُثني وكم يمثّل من المبيعات —
 * لا نسبةً مئويّةً وحدها: «٩٦٪ من الوصفات مكتملة» لا تقول إنّ الأربعة
 * الباقية هي أكثرُ الأصناف مبيعاً.
 */
import { EXCLUSION_LABEL, type ConsumptionResult, type ExclusionReason } from "./consumption";
import { PURCHASE_GAP_LABEL, type PurchaseGapReason, type PurchaseSummary } from "./purchases";

export type Readiness = "READY" | "PARTIAL" | "BLOCKED";

export const READINESS_LABEL: Record<Readiness, string> = {
  READY: "جاهز",
  PARTIAL: "جزئيّ",
  BLOCKED: "متعذّر",
};

export interface CoverageGap {
  kind: "SALES" | "PURCHASES" | "ITEMS";
  reason: ExclusionReason | PurchaseGapReason | "UNIT_CONFLICT" | "NO_UNIT" | "RECEIPT_AMBIGUOUS";
  label: string;
  count: number;
  /** ما يمثّله من المال — الريالُ يقول حجمَ الفجوة أصدقَ من العدد. */
  totalMinor: number;
  /**
   * وحصّتُه من **الوحدات المباعة**، بنقاط الأساس.
   *
   * «٣ منتجات بلا وصفة» لا تقول شيئاً: قد تكون أندرَ ما يُباع وقد تكون
   * أكثرَه. و«تمثّل ٤٫٢٪ من الوحدات المباعة» تقول للقارئ **أيصلح
   * التقرير للعمل به أم لا**.
   */
  unitsShareBp: number | null;
  /** أمثلةٌ بأسمائها — «٣ منتجات» لا تُصلَح، و«سبانيش لاتيه» تُصلَح. */
  examples: string[];
}

export interface CoverageReport {
  readiness: Readiness;
  sales: {
    lines: number;
    /** أيّامٌ فيها مبيعات، مقابلَ أيّام الفترة — فالفترةُ الناقصة تُعلَن. */
    daysWithSales: number;
    periodDays: number;
    missingDays: string[];
    includedLines: number;
    includedTotalMinor: number;
    excludedLines: number;
    excludedTotalMinor: number;
    /** نسبةُ ما دخل الحساب من **مال** المبيعات، بنقاط الأساس. */
    coveredBp: number | null;
    /** ونسبةُ ما دخل منه من **الوحدات المباعة** — وهي أدلُّ على الاستهلاك. */
    unitsCoveredBp: number | null;
    includedUnitsMilli: number;
    excludedUnitsMilli: number;
  };
  purchases: {
    lines: number;
    includedLines: number;
    excludedLines: number;
    excludedTotalMinor: number;
    coveredBp: number | null;
  };
  items: {
    counted: number;
    withKnownOpening: number;
    withKnownCost: number;
  };
  /**
   * نطاقُ الجرد — كم صنفاً فيه وكم استُبعد.
   *
   * ── ولماذا ليس «فجوةَ تغطية» ──
   *
   * الفجوةُ نقصٌ في البيانات يُنقص الثقة بالرقم؛ وهذا **اختيارُ
   * إنسان** معلَن: «لا أعدّ المصّاصات هذا الأسبوع». فلو عُدّ فجوةً
   * لما بلغ جردٌ فيه استبعادٌ واحد حالَ `READY` أبداً — فيتعلّم
   * صاحبُه أنّ الشارة لا تعني شيئاً، ويتجاهل نقصاً حقيقيّاً حين يقع.
   *
   * فيُعلَن عددُه في رأس الشاشة ولا يُنقص الحكم. والأسماءُ محفوظة
   * كي يُقرأ **ما** استُبعد لا كم استُبعد.
   */
  scope: { included: number; excluded: number; excludedNames: string[] };
  gaps: CoverageGap[];
}

const MAX_EXAMPLES = 5;

/** أيّامُ الفترة كلُّها — نصوصاً، بلا `Date` فلا تتسلّل منطقةُ الجلسة. */
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const from = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  const to = Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return out;

  for (let t = from; t <= to; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export interface CoverageInput {
  periodStart: string;
  periodEnd: string;
  salesBusinessDates: readonly string[];
  consumption: ConsumptionResult;
  purchases: PurchaseSummary;
  itemsCounted: number;
  itemsWithKnownOpening: number;
  itemsWithKnownCost: number;
  /** أصنافٌ تضاربت وحداتُها بين وصفتين، أو لا وحدةَ لها. */
  unitConflicts: readonly string[];
  unitlessItems: readonly string[];
  /** فواتيرُ التباسِ الاستلام — تُعرَض ولا تُضمّ. */
  ambiguousReceipts?: readonly { invoiceNumber: string; supplierName: string; lineTotalMinor: number }[];
  /** نطاقُ الجرد: ما دخله وما استُبعد منه باختيار إنسان. */
  scope?: { included: number; excluded: readonly string[] };
}

/**
 * يحسب التغطية ويحكم بالجاهزيّة.
 *
 * والحكم ثلاثة لا اثنان: `BLOCKED` ليس «فشلاً» بل «لا يوجد ما يُحسَب»
 * — لا مبيعاتٍ في الفترة أصلاً، أو لا سطرَ بيعٍ واحد دخل الحساب. وبينه
 * وبين `READY` يقع `PARTIAL`، وهو الحالُ الغالبة في البداية ولا عيبَ
 * فيه ما دام معلَناً.
 */
export function computeCoverage(input: CoverageInput): CoverageReport {
  const period = daysBetween(input.periodStart, input.periodEnd);
  const withSales = new Set(input.salesBusinessDates);
  const missingDays = period.filter((d) => !withSales.has(d));

  const c = input.consumption;
  const salesTotal = c.included.totalMinor + c.excludedTotals.totalMinor;
  const salesLines = c.included.lines + c.excludedTotals.lines;
  const salesCoveredBp = salesTotal === 0 ? null : Math.round((c.included.totalMinor * 10_000) / salesTotal);

  /*
    ── الوحداتُ أدلُّ من الريال على الاستهلاك ──

    صنفٌ رخيصٌ كثيرُ البيع يأكل من المخزون أكثرَ ممّا يقوله سعرُه.
    فحصّةُ الفجوة تُقاس بالوحدات أيضاً، وهي التي تُعرَض للقارئ.
  */
  const includedUnits = Math.abs(c.included.unitsMilli);
  const excludedUnits = c.excluded
    .filter((e) => e.reason !== "VOID")
    .reduce((s, e) => s + Math.abs(e.quantityMilli), 0);
  const unitsTotal = includedUnits + excludedUnits;
  const unitsCoveredBp = unitsTotal === 0 ? null : Math.round((includedUnits * 10_000) / unitsTotal);
  const shareOf = (units: number) => (unitsTotal === 0 ? null : Math.round((units * 10_000) / unitsTotal));

  const p = input.purchases;
  const includedPurchaseLines = p.totalLines - p.gaps.length;
  const purchaseTotal = [...p.byProduct.values()].reduce((s, x) => s + x.knownCostMinor, 0) + p.gapTotals.totalMinor;
  const purchaseCoveredBp =
    purchaseTotal === 0 ? null : Math.round(((purchaseTotal - p.gapTotals.totalMinor) * 10_000) / purchaseTotal);

  const gaps: CoverageGap[] = [];

  /* فجواتُ المبيعات مجموعةً بسببها، ومع كلٍّ أمثلةٌ بأسمائها */
  const byReason = new Map<ExclusionReason, { count: number; total: number; units: number; names: Set<string> }>();
  for (const e of c.excluded) {
    let acc = byReason.get(e.reason);
    if (!acc) { acc = { count: 0, total: 0, units: 0, names: new Set() }; byReason.set(e.reason, acc); }
    acc.count++;
    acc.total += e.lineTotalMinor;
    acc.units += Math.abs(e.quantityMilli);
    if (acc.names.size < MAX_EXAMPLES) acc.names.add(e.posProductName);
  }
  for (const [reason, acc] of byReason) {
    /*
      الملغى ليس فجوةَ تغطية — استُبعد بحقّ لأنّه لم يُصنَع. ويُعرَض
      عدده في مكانٍ آخر، ولا يُنقص «نسبةَ ما حُسب» فيُقرأ نقصاً في
      البيانات وهو اكتمالٌ فيها.
    */
    if (reason === "VOID") continue;
    gaps.push({
      kind: "SALES",
      reason,
      label: EXCLUSION_LABEL[reason],
      count: acc.count,
      totalMinor: acc.total,
      unitsShareBp: shareOf(acc.units),
      examples: [...acc.names],
    });
  }

  const byPurchaseReason = new Map<PurchaseGapReason, { count: number; total: number; names: Set<string> }>();
  for (const g of p.gaps) {
    let acc = byPurchaseReason.get(g.reason);
    if (!acc) { acc = { count: 0, total: 0, names: new Set() }; byPurchaseReason.set(g.reason, acc); }
    acc.count++;
    acc.total += g.lineTotalMinor;
    if (acc.names.size < MAX_EXAMPLES) acc.names.add(g.description);
  }
  for (const [reason, acc] of byPurchaseReason) {
    gaps.push({
      kind: "PURCHASES",
      reason,
      label: PURCHASE_GAP_LABEL[reason],
      count: acc.count,
      totalMinor: acc.total,
      unitsShareBp: null,
      examples: [...acc.names],
    });
  }

  if (input.unitConflicts.length > 0) {
    gaps.push({
      kind: "ITEMS",
      reason: "UNIT_CONFLICT",
      label: "صنفٌ ذُكر بوحدتين من عائلتين مختلفتين — ولا جسرَ بين وزنٍ وحجم",
      count: input.unitConflicts.length,
      totalMinor: 0,
      unitsShareBp: null,
      examples: input.unitConflicts.slice(0, MAX_EXAMPLES),
    });
  }
  /*
    ── التباسُ الاستلام يُعرَض ولا يُحسَب ──

    تاريخُ الفاتورة نائبٌ عن تاريخ الاستلام (لا عمودَ استلامٍ في
    المخطّط). ففاتورةٌ تلي نهايةَ الفترة بيومٍ قد تكون بضاعتَها.
    وضمُّها بالحدس يُنقص الفرق، وإسقاطُها يزيده — فتُعرَض ليقرّر إنسان.
  */
  const ambiguous = input.ambiguousReceipts ?? [];
  if (ambiguous.length > 0) {
    gaps.push({
      kind: "PURCHASES",
      reason: "RECEIPT_AMBIGUOUS",
      label: "فاتورةُ شراءٍ تلي نهايةَ الفترة بأيّامٍ قليلة — أوصلت بضاعةً داخلها؟",
      count: ambiguous.length,
      totalMinor: ambiguous.reduce((s, a) => s + a.lineTotalMinor, 0),
      unitsShareBp: null,
      examples: [...new Set(ambiguous.map((a) => `${a.supplierName} · ${a.invoiceNumber}`))].slice(0, MAX_EXAMPLES),
    });
  }

  if (input.unitlessItems.length > 0) {
    gaps.push({
      kind: "ITEMS",
      reason: "NO_UNIT",
      label: "صنفٌ وحدةُ قياسه غير معروفة",
      count: input.unitlessItems.length,
      totalMinor: 0,
      unitsShareBp: null,
      examples: input.unitlessItems.slice(0, MAX_EXAMPLES),
    });
  }

  const blocked = salesLines === 0 || c.included.lines === 0;
  const readiness: Readiness = blocked ? "BLOCKED" : gaps.length === 0 && missingDays.length === 0 ? "READY" : "PARTIAL";

  return {
    readiness,
    sales: {
      lines: salesLines,
      daysWithSales: period.filter((d) => withSales.has(d)).length,
      periodDays: period.length,
      missingDays,
      includedLines: c.included.lines,
      includedTotalMinor: c.included.totalMinor,
      excludedLines: c.excludedTotals.lines,
      excludedTotalMinor: c.excludedTotals.totalMinor,
      coveredBp: salesCoveredBp,
      unitsCoveredBp,
      includedUnitsMilli: includedUnits,
      excludedUnitsMilli: excludedUnits,
    },
    purchases: {
      lines: p.totalLines,
      includedLines: includedPurchaseLines,
      excludedLines: p.gaps.length,
      excludedTotalMinor: p.gapTotals.totalMinor,
      coveredBp: purchaseCoveredBp,
    },
    items: {
      counted: input.itemsCounted,
      withKnownOpening: input.itemsWithKnownOpening,
      withKnownCost: input.itemsWithKnownCost,
    },
    scope: {
      included: input.scope?.included ?? 0,
      excluded: input.scope?.excluded.length ?? 0,
      excludedNames: [...(input.scope?.excluded ?? [])].slice(0, MAX_EXAMPLES),
    },
    gaps,
  };
}

/** جملةٌ واحدة تقول حالَ التقرير — تُعرَض فوقه دائماً لا عند العطب. */
export function describeCoverage(c: CoverageReport): string {
  if (c.readiness === "BLOCKED") {
    return c.sales.lines === 0
      ? "لا مبيعاتٍ في هذه الفترة — استورِد ملفّ فودكس أوّلاً."
      : "لم يدخل الحسابَ سطرُ بيعٍ واحد: لا صنفَ مربوطٌ بوصفةٍ سارية.";
  }
  if (c.readiness === "READY") {
    return "كلُّ ما بِيع في الفترة مربوطٌ وله وصفةٌ سارية، وكلُّ سطرِ شراءٍ عُرفت كمّيّتُه.";
  }

  const bits: string[] = [];
  if (c.sales.unitsCoveredBp !== null) {
    bits.push(`دخل الحسابَ ${Math.round(c.sales.unitsCoveredBp / 100)}٪ من الوحدات المباعة`);
  }
  if (c.sales.missingDays.length > 0) {
    bits.push(`و${c.sales.missingDays.length} يوماً بلا مبيعاتٍ مستوردة`);
  }
  if (c.purchases.excludedLines > 0) {
    bits.push(`و${c.purchases.excludedLines} سطرَ شراءٍ لم تُعرَف كمّيّتُه`);
  }
  return `تقريرٌ جزئيّ: ${bits.join("، ")}.`;
}
