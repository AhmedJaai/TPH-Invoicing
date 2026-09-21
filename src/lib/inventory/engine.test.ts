import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, reconcile, topVariances, type EngineInput } from "./engine";
import { canonicalToQuantity, toCanonical } from "./units";
import type { RecipeVersionInput } from "./recipe";
import type { SoldLineInput } from "./consumption";
import type { PurchaseLineInput } from "./purchases";

const kg = (n: number) => toCanonical(n * 1000, "KG");
const L = (n: number) => toCanonical(n * 1000, "L");

const COFFEE = "p-coffee";
const MILK = "p-milk";
const LATTE = "m-latte";

const PRODUCTS = [
  { id: COFFEE, nameAr: "حبوب قهوة", category: "COFFEE", baseUnit: "KG" as const },
  { id: MILK, nameAr: "حليب", category: "DAIRY", baseUnit: "L" as const },
];

const RECIPE: RecipeVersionInput = {
  id: "v1", recipeId: "r1", menuProductId: LATTE, version: 1, status: "ACTIVE",
  effectiveFrom: "2026-09-01", effectiveTo: null,
  yieldQuantityMilli: null, yieldUnit: null,
  ingredients: [
    { productId: COFFEE, quantityMilli: 18_000, unit: "G", prepLossBp: null },
    { productId: MILK, quantityMilli: 180_000, unit: "ML", prepLossBp: null },
  ],
};

function soldLines(count: number, date = "2026-09-03"): SoldLineInput[] {
  return [{
    saleId: "s1", lineId: "l1", businessDate: date,
    posProductName: "Spanish Latte", posProductExternalId: "FDX-1",
    menuProductId: LATTE, quantityMilli: count * 1000,
    lineTotalMinor: count * 1800, isRefund: false, isVoid: false, isComplimentary: false,
  }];
}

function purchase(over: Partial<PurchaseLineInput> = {}): PurchaseLineInput {
  return {
    lineId: "il-1", invoiceId: "inv-1", invoiceNumber: "A-1", supplierName: "محمصة",
    invoiceDate: "2026-09-02", description: "بنّ", productId: COFFEE,
    qty: "1", lineTotalMinor: 1500_00,
    packSize: "1", contentUnit: "KG", contentQuantity: "20",
    ...over,
  };
}

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    periodStart: "2026-09-01",
    periodEnd: "2026-09-07",
    products: PRODUCTS,
    soldLines: soldLines(100),
    recipeVersions: [RECIPE],
    purchaseLines: [purchase()],
    openingByProduct: new Map([[COFFEE, kg(5)], [MILK, L(30)]]),
    adjustmentsInByProduct: new Map(),
    adjustmentsOutByProduct: new Map(),
    wasteByProduct: new Map(),
    actualByProduct: new Map([[COFFEE, kg(10.5)], [MILK, L(25.4)]]),
    fallbackCostByProduct: new Map([[MILK, 12_00]]),
    ...over,
  };
}

describe("المحرّك — من البيعة إلى الفرق", () => {
  it("١٠٠ مشروبٍ: افتتاحيّ ٥ + شراء ٢٠ − استهلاك ١٫٨ = ٢٣٫٢ متوقَّعاً", () => {
    const r = reconcile(input());
    const coffee = r.lines.find((l) => l.productId === COFFEE)!;

    expect(canonicalToQuantity(coffee.openingMilli!, "KG")).toBe(5);
    expect(canonicalToQuantity(coffee.purchasesMilli!, "KG")).toBe(20);
    expect(canonicalToQuantity(coffee.theoreticalConsumptionMilli!, "KG")).toBe(1.8);
    expect(canonicalToQuantity(coffee.theoreticalClosingMilli!, "KG")).toBe(23.2);
    expect(canonicalToQuantity(coffee.varianceMilli!, "KG")).toBe(-12.7);
  });

  it("وكلفةُ الوحدة من مشتريات الفترة، وكلفةُ الفرق عددٌ صحيح", () => {
    const r = reconcile(input());
    const coffee = r.lines.find((l) => l.productId === COFFEE)!;
    /* ‏١٬٥٠٠ ريالاً على ٢٠ كجم = ٧٥ للكيلو */
    expect(coffee.unitCostMinor).toBe(75_00);
    expect(coffee.varianceCostMinor).toBe(-952_50);
    expect(Number.isInteger(coffee.varianceCostMinor!)).toBe(true);
  });

  it("والحليبُ لم يُشترَ في الفترة — مشترياتُه صفرٌ حقيقيّ، وكلفتُه من السابق", () => {
    const r = reconcile(input());
    const milk = r.lines.find((l) => l.productId === MILK)!;
    expect(milk.purchasesMilli).toBe(0);
    expect(canonicalToQuantity(milk.theoreticalConsumptionMilli!, "L")).toBe(18);
    expect(canonicalToQuantity(milk.theoreticalClosingMilli!, "L")).toBe(12);
    expect(milk.unitCostMinor).toBe(12_00);
  });

  it("ونسخةُ المحرّك مكتوبةٌ في التقرير", () => {
    expect(reconcile(input()).engineVersion).toBe(ENGINE_VERSION);
  });
});

describe("التغطيةُ تُحسَب ولا تُدَّعى", () => {
  it("تغطيةٌ تامّةٌ لأسبوعٍ فيه مبيعاتُ كلّ يوم ← READY", () => {
    const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"];
    const r = reconcile(input({
      soldLines: days.flatMap((d, i) => soldLines(10, d).map((l) => ({ ...l, lineId: `l${i}` }))),
    }));
    expect(r.coverage.readiness).toBe("READY");
    expect(r.coverage.gaps).toEqual([]);
  });

  it("وأيّامٌ بلا مبيعاتٍ تُعلَن — الفترةُ الناقصة ليست فترةً كاملة", () => {
    const r = reconcile(input());
    expect(r.coverage.readiness).toBe("PARTIAL");
    expect(r.coverage.sales.daysWithSales).toBe(1);
    expect(r.coverage.sales.periodDays).toBe(7);
    expect(r.coverage.sales.missingDays).toHaveLength(6);
  });

  it("وصنفٌ بِيع بلا وصفةٍ يُعلَن بعدده ومبلغه ونسبتِه من المبيعات", () => {
    const r = reconcile(input({
      soldLines: [
        ...soldLines(100),
        {
          saleId: "s2", lineId: "l2", businessDate: "2026-09-03",
          posProductName: "Iced Tea", posProductExternalId: "FDX-9",
          menuProductId: null, quantityMilli: 50 * 1000, lineTotalMinor: 60_000,
          isRefund: false, isVoid: false, isComplimentary: false,
        },
      ],
    }));

    const gap = r.coverage.gaps.find((g) => g.reason === "UNMAPPED_POS_PRODUCT")!;
    expect(gap.count).toBe(1);
    expect(gap.totalMinor).toBe(60_000);
    expect(gap.examples).toContain("Iced Tea");
    /* ‏١٨٠٬٠٠٠ من ٢٤٠٬٠٠٠ = ٧٥٪ دخلت الحساب */
    expect(r.coverage.sales.coveredBp).toBe(7500);
  });

  it("وبندُ شراءٍ لم تُعرَف كمّيّتُه يُخرج مشترياتِ صنفه إلى «مجهول» — لا ينقصها صامتاً", () => {
    const r = reconcile(input({
      purchaseLines: [purchase(), purchase({ lineId: "il-2", packSize: null, lineTotalMinor: 450_00 })],
    }));
    const coffee = r.lines.find((l) => l.productId === COFFEE)!;
    expect(coffee.purchasesMilli).toBeNull();
    expect(coffee.theoreticalClosingMilli).toBeNull();
    expect(coffee.varianceMilli).toBeNull();
    expect(coffee.flags).toContain("PURCHASES_UNKNOWN");
    expect(r.coverage.gaps.some((g) => g.reason === "NO_PACK_SPEC")).toBe(true);
  });

  it("ولا مبيعاتٍ أصلاً ← BLOCKED، ولا يُحسَب فرقٌ على فراغ", () => {
    const r = reconcile(input({ soldLines: [] }));
    expect(r.coverage.readiness).toBe("BLOCKED");
  });

  it("وصنفٌ لم يُعَدّ يُوسَم ولا يدخل مجموع الكلفة", () => {
    const r = reconcile(input({ actualByProduct: new Map([[COFFEE, kg(10.5)]]) }));
    const milk = r.lines.find((l) => l.productId === MILK)!;
    expect(milk.flags).toContain("NOT_COUNTED");
    expect(milk.varianceMilli).toBeNull();
    expect(r.totals.linesCounted).toBe(1);
  });

  it("والافتتاحيُّ المجهول يُوسَم ويمنع الحساب — ولا يُقرأ صفراً", () => {
    const r = reconcile(input({ openingByProduct: new Map([[MILK, L(30)]]) }));
    const coffee = r.lines.find((l) => l.productId === COFFEE)!;
    expect(coffee.flags).toContain("OPENING_UNKNOWN");
    expect(coffee.theoreticalClosingMilli).toBeNull();
  });
});

describe("المجموعُ يقول ما سقط منه", () => {
  it("كلفةُ الفروق لا تشمل ما جُهلت كلفتُه، ويُعَدّ ذلك", () => {
    const r = reconcile(input({ fallbackCostByProduct: new Map() }));
    const milk = r.lines.find((l) => l.productId === MILK)!;
    expect(milk.varianceCostMinor).toBeNull();
    expect(milk.flags).toContain("COST_UNKNOWN");
    expect(r.totals.linesWithKnownCost).toBe(1);
    expect(r.totals.linesWithVariance).toBe(2);
  });

  it("وأكبرُ الفروق مرتَّبةٌ بالكلفة لا بالكمّيّة", () => {
    const r = reconcile(input());
    const top = topVariances(r, 5);
    expect(top[0].productId).toBe(COFFEE);
    expect(Math.abs(top[0].varianceCostMinor!)).toBeGreaterThan(Math.abs(top[1].varianceCostMinor!));
  });
});

describe("تغيُّرُ الوصفة لا يُعاد به حسابُ ما مضى", () => {
  it("بيعاتُ الأسبوع الأوّل بـ٢٠ جراماً وإن صارت الوصفةُ ١٨ بعده", () => {
    const twenty: RecipeVersionInput = {
      ...RECIPE, id: "v-20", effectiveFrom: "2026-09-01", effectiveTo: "2026-09-07",
      ingredients: [{ productId: COFFEE, quantityMilli: 20_000, unit: "G", prepLossBp: null }],
    };
    const eighteen: RecipeVersionInput = {
      ...RECIPE, id: "v-18", version: 2, effectiveFrom: "2026-09-08", effectiveTo: null,
      ingredients: [{ productId: COFFEE, quantityMilli: 18_000, unit: "G", prepLossBp: null }],
    };

    const first = reconcile(input({ recipeVersions: [twenty, eighteen], soldLines: soldLines(100, "2026-09-03") }));
    const coffee = first.lines.find((l) => l.productId === COFFEE)!;
    expect(canonicalToQuantity(coffee.theoreticalConsumptionMilli!, "KG")).toBe(2);
    expect(coffee.recipeVersionIds).toEqual(["v-20"]);

    const second = reconcile(input({
      periodStart: "2026-09-08", periodEnd: "2026-09-14",
      recipeVersions: [twenty, eighteen],
      soldLines: soldLines(100, "2026-09-09"),
    }));
    const later = second.lines.find((l) => l.productId === COFFEE)!;
    expect(canonicalToQuantity(later.theoreticalConsumptionMilli!, "KG")).toBe(1.8);
    expect(later.recipeVersionIds).toEqual(["v-18"]);
  });
});
