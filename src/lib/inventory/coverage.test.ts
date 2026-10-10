import { describe, expect, it } from "vitest";
import { computeCoverage, daysBetween, describeCoverage, type CoverageInput } from "./coverage";
import type { ConsumptionResult, ExcludedLine, ExclusionReason } from "./consumption";
import type { PurchaseGap, PurchaseSummary } from "./purchases";

/**
 * التغطية تقرّر «أيُحكَم على الفرق أم لا» — فحكمُها على مجموعةٍ فارغة هو موضعُ
 * الكذب العمليّ: لا مبيعاتٍ ليست «تغطيةً كاملة»، ونسبةٌ بلا مقامٍ `null` لا مئة.
 */
const excluded = (reason: ExclusionReason, name: string, quantityMilli: number, lineTotalMinor: number): ExcludedLine => ({
  lineId: `l-${name}-${quantityMilli}`,
  posProductName: name,
  posProductExternalId: null,
  menuProductId: null,
  businessDate: "2026-09-01",
  quantityMilli,
  lineTotalMinor,
  reason,
});

function consumption(
  included: { lines: number; unitsMilli: number; totalMinor: number },
  excludedLines: ExcludedLine[] = [],
): ConsumptionResult {
  return {
    byIngredient: new Map(),
    included,
    excluded: excludedLines,
    excludedTotals: {
      lines: excludedLines.length,
      unitsMilli: excludedLines.reduce((s, e) => s + e.quantityMilli, 0),
      totalMinor: excludedLines.reduce((s, e) => s + e.lineTotalMinor, 0),
    },
  };
}

function purchases(knownCostMinor: number[], gaps: PurchaseGap[] = []): PurchaseSummary {
  return {
    byProduct: new Map(knownCostMinor.map((cost, i) => [`p${i}`, {
      productId: `p${i}`, canonicalMilli: 1_000, knownCostMinor: cost, costedMilli: 1_000,
      manualMilli: 0, returnsMilli: 0, lines: 1, invoiceLineIds: [`il${i}`], receiptIds: [],
    }])),
    gaps,
    gapTotals: { lines: gaps.length, totalMinor: gaps.reduce((s, g) => s + g.lineTotalMinor, 0) },
    totalLines: knownCostMinor.length + gaps.length,
  };
}

const gap = (description: string, lineTotalMinor: number, reason: PurchaseGap["reason"] = "NO_PACK_SPEC"): PurchaseGap => ({
  lineId: `g-${description}`, invoiceNumber: "INV-1", supplierName: "مورّد", description,
  productId: null, lineTotalMinor, reason,
});

const WEEK = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"];

const input = (over: Partial<CoverageInput> = {}): CoverageInput => ({
  periodStart: "2026-09-01",
  periodEnd: "2026-09-07",
  salesBusinessDates: WEEK,
  consumption: consumption({ lines: 10, unitsMilli: 10_000, totalMinor: 20_000 }),
  purchases: purchases([5_000]),
  itemsCounted: 3,
  itemsWithKnownOpening: 3,
  itemsWithKnownCost: 3,
  unitConflicts: [],
  unitlessItems: [],
  ...over,
});

describe("daysBetween", () => {
  it("الطرفان داخلان، ويومٌ واحد يومٌ واحد", () => {
    expect(daysBetween("2026-09-01", "2026-09-07")).toEqual(WEEK);
    expect(daysBetween("2026-09-01", "2026-09-01")).toEqual(["2026-09-01"]);
  });

  it("يعبر حافّةَ الشهر والسنة والكبيسة بلا يومٍ ناقصٍ ولا مكرَّر", () => {
    expect(daysBetween("2026-08-30", "2026-09-02")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
    expect(daysBetween("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
    expect(daysBetween("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(daysBetween("2026-02-28", "2026-03-01")).toEqual(["2026-02-28", "2026-03-01"]);
    expect(daysBetween("2026-01-01", "2026-12-31")).toHaveLength(365);
  });

  it("نهايةٌ قبل البداية أو نصٌّ ليس تاريخاً: لا أيّام — لا فترةٌ مخترَعة", () => {
    expect(daysBetween("2026-09-07", "2026-09-01")).toEqual([]);
    expect(daysBetween("", "2026-09-01")).toEqual([]);
    expect(daysBetween("أمس", "اليوم")).toEqual([]);
  });
});

describe("computeCoverage", () => {
  it("أسبوعٌ كامل وكلُّه محسوب: جاهز، والنِّسبُ مئةٌ بالمئة", () => {
    const c = computeCoverage(input());
    expect(c.readiness).toBe("READY");
    expect(c.sales.periodDays).toBe(7);
    expect(c.sales.daysWithSales).toBe(7);
    expect(c.sales.missingDays).toEqual([]);
    expect(c.sales.coveredBp).toBe(10_000);
    expect(c.sales.unitsCoveredBp).toBe(10_000);
    expect(c.purchases.coveredBp).toBe(10_000);
    expect(c.gaps).toEqual([]);
    expect(describeCoverage(c)).toContain("كلُّ ما بِيع");
  });

  it("يومٌ ناقص في الوسط: جزئيّ ويُسمّى اليوم", () => {
    const c = computeCoverage(input({ salesBusinessDates: WEEK.filter((d) => d !== "2026-09-04") }));
    expect(c.readiness).toBe("PARTIAL");
    expect(c.sales.missingDays).toEqual(["2026-09-04"]);
    expect(c.sales.daysWithSales).toBe(6);
    expect(describeCoverage(c)).toContain("يوماً بلا مبيعاتٍ");
  });

  it("ملفّان متداخلان ويومٌ خارج الفترة: اليومُ يُعدّ مرّةً، والخارجُ لا يُعدّ", () => {
    const c = computeCoverage(input({
      salesBusinessDates: [...WEEK, "2026-09-03", "2026-09-04", "2026-08-31", "2026-09-08"],
    }));
    expect(c.sales.daysWithSales).toBe(7);
    expect(c.sales.missingDays).toEqual([]);
    expect(c.readiness).toBe("READY");
  });

  it("لا مبيعاتٍ أصلاً: متعذّر، والنِّسبُ «لا تُعرَف» — لا مئةٌ على مجموعةٍ فارغة ولا صفر", () => {
    const c = computeCoverage(input({
      salesBusinessDates: [],
      consumption: consumption({ lines: 0, unitsMilli: 0, totalMinor: 0 }),
      purchases: purchases([]),
    }));
    expect(c.readiness).toBe("BLOCKED");
    expect(c.sales.coveredBp).toBeNull();
    expect(c.sales.unitsCoveredBp).toBeNull();
    expect(c.purchases.coveredBp).toBeNull();
    expect(c.sales.missingDays).toHaveLength(7);
    expect(describeCoverage(c)).toContain("لا مبيعاتٍ في هذه الفترة");
  });

  it("مبيعاتٌ ولم يدخل الحسابَ منها سطر: متعذّر — ويقول لماذا", () => {
    const c = computeCoverage(input({
      consumption: consumption(
        { lines: 0, unitsMilli: 0, totalMinor: 0 },
        [excluded("NO_RECIPE", "سبانيش لاتيه", 3_000, 5_400)],
      ),
    }));
    expect(c.readiness).toBe("BLOCKED");
    expect(c.sales.coveredBp).toBe(0);
    expect(describeCoverage(c)).toContain("لم يدخل الحسابَ سطرُ بيعٍ واحد");
  });

  it("فجوةُ مبيعاتٍ تُجمَع بسببها، بعددها ومالها وحصّتها من الوحدات وأسمائها", () => {
    const c = computeCoverage(input({
      consumption: consumption(
        { lines: 8, unitsMilli: 8_500, totalMinor: 18_000 },
        [
          excluded("NO_RECIPE", "سبانيش لاتيه", 600, 1_200),
          excluded("NO_RECIPE", "سبانيش لاتيه", 400, 800),
          excluded("UNMAPPED_POS_PRODUCT", "كوكيز", -500, -900),
        ],
      ),
    }));
    expect(c.readiness).toBe("PARTIAL");
    const noRecipe = c.gaps.find((g) => g.reason === "NO_RECIPE")!;
    expect(noRecipe).toMatchObject({ kind: "SALES", count: 2, totalMinor: 2_000, unitsShareBp: 1_000, examples: ["سبانيش لاتيه"] });
    // المرتجَعُ يُعدّ بمقداره: خمسُمئةٍ من عشرة آلاف
    expect(c.gaps.find((g) => g.reason === "UNMAPPED_POS_PRODUCT")!.unitsShareBp).toBe(500);
    expect(c.sales.unitsCoveredBp).toBe(8_500);
    expect(c.sales.includedUnitsMilli + c.sales.excludedUnitsMilli).toBe(10_000);
    expect(c.sales.lines).toBe(11);
  });

  it("الملغى ليس فجوة: لم يُصنَع، فلا يُنقص الجاهزيّة ولا حصّةَ الوحدات", () => {
    const c = computeCoverage(input({
      consumption: consumption(
        { lines: 10, unitsMilli: 10_000, totalMinor: 20_000 },
        [excluded("VOID", "لاتيه", 2_000, 3_600)],
      ),
    }));
    expect(c.gaps).toEqual([]);
    expect(c.readiness).toBe("READY");
    expect(c.sales.unitsCoveredBp).toBe(10_000);
    expect(c.sales.excludedUnitsMilli).toBe(0);
  });

  it("سطرُ شراءٍ لم تُعرَف كمّيّتُه: جزئيّ، ونسبتُه من مال المشتريات", () => {
    const c = computeCoverage(input({ purchases: purchases([7_500], [gap("حليب كرتون", 2_500)]) }));
    expect(c.readiness).toBe("PARTIAL");
    expect(c.purchases).toMatchObject({ lines: 2, includedLines: 1, excludedLines: 1, excludedTotalMinor: 2_500, coveredBp: 7_500 });
    expect(c.gaps).toEqual([expect.objectContaining({ kind: "PURCHASES", reason: "NO_PACK_SPEC", count: 1, totalMinor: 2_500, examples: ["حليب كرتون"] })]);
    expect(describeCoverage(c)).toContain("سطرَ شراءٍ لم تُعرَف كمّيّتُه");
  });

  it("تضاربُ الوحدات والتباسُ الاستلام واحتمالُ التكرار فجواتٌ تُنقص الجاهزيّة", () => {
    const c = computeCoverage(input({
      unitConflicts: ["حليب"],
      unitlessItems: ["مصّاصات"],
      ambiguousReceipts: [
        { invoiceNumber: "INV-9", supplierName: "لوريفا", lineTotalMinor: 4_000 },
        { invoiceNumber: "INV-9", supplierName: "لوريفا", lineTotalMinor: 1_000 },
      ],
      receiptDuplicates: [{ productName: "بنّ", invoiceNumber: "INV-3", supplierName: "مختبرات القهوة" }],
    }));
    expect(c.readiness).toBe("PARTIAL");
    expect(c.gaps.map((g) => g.reason).sort()).toEqual(["NO_UNIT", "RECEIPT_AMBIGUOUS", "RECEIPT_POSSIBLE_DUPLICATE", "UNIT_CONFLICT"]);
    const ambiguous = c.gaps.find((g) => g.reason === "RECEIPT_AMBIGUOUS")!;
    expect(ambiguous).toMatchObject({ count: 2, totalMinor: 5_000, examples: ["لوريفا · INV-9"] });
  });

  it("النطاقُ اختيارُ إنسانٍ لا فجوة: يُعلَن ولا يُنقص «جاهز»", () => {
    const c = computeCoverage(input({ scope: { included: 12, excluded: ["مصّاصات", "مناديل"] } }));
    expect(c.readiness).toBe("READY");
    expect(c.scope).toEqual({ included: 12, excluded: 2, excludedNames: ["مصّاصات", "مناديل"] });
  });

  it("الأمثلةُ خمسةٌ على الأكثر، والعددُ كاملٌ", () => {
    const many = Array.from({ length: 9 }, (_, i) => excluded("NO_RECIPE", `صنف ${i}`, 100, 100));
    const c = computeCoverage(input({ consumption: consumption({ lines: 1, unitsMilli: 1_000, totalMinor: 1_000 }, many) }));
    const g = c.gaps.find((x) => x.reason === "NO_RECIPE")!;
    expect(g.count).toBe(9);
    expect(g.examples).toHaveLength(5);
  });
});
