import { describe, expect, it } from "vitest";
import { computeConsumption, ingredientForSale, type SoldLineInput } from "./consumption";
import { indexRecipeVersions, effectiveVersion, type RecipeVersionInput } from "./recipe";
import { canonicalToQuantity } from "./units";

/* ─────────────────── تجهيزٌ يُقرأ ─────────────────── */

const COFFEE = "p-coffee";
const MILK = "p-milk";
const CONDENSED = "p-condensed";
const LATTE = "m-latte";
const AMERICANO = "m-americano";

function version(over: Partial<RecipeVersionInput> = {}): RecipeVersionInput {
  return {
    id: "v1", recipeId: "r1", menuProductId: LATTE, version: 1, status: "ACTIVE",
    effectiveFrom: "2026-09-01", effectiveTo: null,
    yieldQuantityMilli: null, yieldUnit: null,
    ingredients: [{ productId: COFFEE, quantityMilli: 18_000, unit: "G", prepLossBp: null }],
    ...over,
  };
}

function sold(over: Partial<SoldLineInput> = {}): SoldLineInput {
  return {
    saleId: "s1", lineId: `l-${Math.random()}`, businessDate: "2026-09-03",
    posProductName: "Spanish Latte", posProductExternalId: "FDX-1",
    menuProductId: LATTE, quantityMilli: 1000,
    lineTotalMinor: 1800, isRefund: false, isVoid: false, isComplimentary: false,
    ...over,
  };
}

/* ─────────────────── الحساب ─────────────────── */

describe("استهلاكُ مكوّنٍ واحد", () => {
  it("٢٠ جراماً × ١٠٠ مشروب = ٢ كجم", () => {
    const versions = indexRecipeVersions([
      version({ ingredients: [{ productId: COFFEE, quantityMilli: 20_000, unit: "G", prepLossBp: null }] }),
    ]);
    const result = computeConsumption([sold({ quantityMilli: 100 * 1000 })], versions);

    const coffee = result.byIngredient.get(COFFEE)!;
    expect(coffee.canonicalMilli).toBe(2_000_000);
    expect(canonicalToQuantity(coffee.canonicalMilli, "KG")).toBe(2);
    expect(coffee.recipeVersionIds).toEqual(["v1"]);
  });

  it("والصيغةُ نفسُها تُختبَر وحدها", () => {
    expect(ingredientForSale(100 * 1000, 20_000, 1000, null)).toBe(2_000_000);
    expect(ingredientForSale(1000, 18_000, 1000, null)).toBe(18_000);
  });

  it("فاقدُ التجهيز يرفع المصروف — ‏`q ÷ (1 − loss)` لا `q × (1 + loss)`", () => {
    /* ٥٪ فاقد: ١٠٠ جرامٍ في الكوب تعني ١٠٥٫٢٦ من الرفّ لا ١٠٥ */
    expect(ingredientForSale(1000, 100_000, 1000, 500)).toBe(105_263);
  });
});

describe("وصفةٌ بمكوّناتٍ عدّة", () => {
  const versions = indexRecipeVersions([
    version({
      ingredients: [
        { productId: COFFEE, quantityMilli: 18_000, unit: "G", prepLossBp: null },
        { productId: MILK, quantityMilli: 180_000, unit: "ML", prepLossBp: null },
        { productId: CONDENSED, quantityMilli: 30_000, unit: "G", prepLossBp: null },
      ],
    }),
  ]);

  it("١٠٠ مشروبٍ تحسب كلَّ مكوّنٍ على حدة", () => {
    const r = computeConsumption([sold({ quantityMilli: 100 * 1000 })], versions);

    expect(canonicalToQuantity(r.byIngredient.get(COFFEE)!.canonicalMilli, "KG")).toBe(1.8);
    expect(canonicalToQuantity(r.byIngredient.get(MILK)!.canonicalMilli, "L")).toBe(18);
    expect(canonicalToQuantity(r.byIngredient.get(CONDENSED)!.canonicalMilli, "KG")).toBe(3);
    expect(r.included.lines).toBe(1);
  });
});

describe("نسخُ الوصفة مؤرَّخة — وهذا شرطُ صدق التقرير التاريخيّ", () => {
  const twenty = version({
    id: "v-20", version: 1, effectiveFrom: "2026-09-01", effectiveTo: "2026-09-07",
    ingredients: [{ productId: COFFEE, quantityMilli: 20_000, unit: "G", prepLossBp: null }],
  });
  const eighteen = version({
    id: "v-18", version: 2, effectiveFrom: "2026-09-08", effectiveTo: null,
    ingredients: [{ productId: COFFEE, quantityMilli: 18_000, unit: "G", prepLossBp: null }],
  });
  const versions = indexRecipeVersions([twenty, eighteen]);

  it("بيعةُ ٥ سبتمبر تأخذ ٢٠ جراماً، وبيعةُ ٩ سبتمبر تأخذ ١٨", () => {
    expect(effectiveVersion(versions, LATTE, "2026-09-05")?.id).toBe("v-20");
    expect(effectiveVersion(versions, LATTE, "2026-09-09")?.id).toBe("v-18");
  });

  it("وفي الأسبوع الواحد تعمل النسختان معاً — لا الأحدثُ وحدها", () => {
    const r = computeConsumption(
      [
        sold({ businessDate: "2026-09-05", quantityMilli: 100 * 1000 }),
        sold({ businessDate: "2026-09-09", quantityMilli: 100 * 1000 }),
      ],
      versions,
    );
    const coffee = r.byIngredient.get(COFFEE)!;
    /* ٢ كجم + ١٫٨ كجم = ٣٫٨ — لا ٣٫٦ (كلُّها بالأحدث) ولا ٤ (كلُّها بالأقدم) */
    expect(canonicalToQuantity(coffee.canonicalMilli, "KG")).toBe(3.8);
    expect(coffee.recipeVersionIds.sort()).toEqual(["v-18", "v-20"]);
  });

  it("وما قبل أوّل نسخةٍ لا وصفةَ له — ولا يُؤخَذ الأقربُ", () => {
    expect(effectiveVersion(versions, LATTE, "2026-08-31")).toBeNull();
    const r = computeConsumption([sold({ businessDate: "2026-08-31" })], versions);
    expect(r.byIngredient.size).toBe(0);
    expect(r.excluded[0].reason).toBe("NO_EFFECTIVE_VERSION");
  });

  it("والمسوّدةُ لا تُحسَب ولو غطّى تاريخُها البيعة", () => {
    const draft = indexRecipeVersions([version({ status: "DRAFT" })]);
    const r = computeConsumption([sold()], draft);
    expect(r.excluded[0].reason).toBe("NO_EFFECTIVE_VERSION");
  });
});

describe("الملغى والمرتجَع والمجانيّ — ثلاثةٌ لا واحد", () => {
  const versions = indexRecipeVersions([version()]);

  it("الملغى يُستبعَد كلُّه: لم يُصنَع أصلاً", () => {
    const r = computeConsumption([sold({ isVoid: true, quantityMilli: 50 * 1000 })], versions);
    expect(r.byIngredient.size).toBe(0);
    expect(r.excluded[0].reason).toBe("VOID");
    expect(r.included.lines).toBe(0);
  });

  it("والمرتجَع يُنقص الاستهلاك", () => {
    const r = computeConsumption(
      [
        sold({ quantityMilli: 10 * 1000 }),
        sold({ quantityMilli: 2 * 1000, isRefund: true }),
      ],
      versions,
    );
    const coffee = r.byIngredient.get(COFFEE)!;
    /* ٨ مشروباتٍ صافية × ١٨ جراماً = ١٤٤ جراماً */
    expect(canonicalToQuantity(coffee.canonicalMilli, "G")).toBe(144);
    expect(coffee.fromRefundsMilli).toBe(-36_000);
  });

  it("والمجانيّ يُستهلَك ويُعَدّ على حدة — صُنع فعلاً وخرجت مكوّناتُه", () => {
    const r = computeConsumption(
      [
        sold({ quantityMilli: 10 * 1000 }),
        sold({ quantityMilli: 2 * 1000, isComplimentary: true, lineTotalMinor: 0 }),
      ],
      versions,
    );
    const coffee = r.byIngredient.get(COFFEE)!;
    expect(canonicalToQuantity(coffee.canonicalMilli, "G")).toBe(216);
    expect(coffee.fromComplimentaryMilli).toBe(36_000);
    expect(coffee.fromSalesMilli).toBe(180_000);
  });
});

describe("ما لا يُحسَب يُعلَن — ولا يُبتلَع", () => {
  const versions = indexRecipeVersions([version()]);

  it("صنفُ فودكس غير المربوط يُستبعَد بسببه، ومعه مبلغُه", () => {
    const r = computeConsumption(
      [sold({ menuProductId: null, posProductName: "Iced Tea", lineTotalMinor: 2200 })],
      versions,
    );
    expect(r.byIngredient.size).toBe(0);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0].reason).toBe("UNMAPPED_POS_PRODUCT");
    expect(r.excluded[0].posProductName).toBe("Iced Tea");
    expect(r.excludedTotals.totalMinor).toBe(2200);
  });

  it("وصنفٌ مربوطٌ بلا وصفةٍ أصلاً يُفرَّق عمّن له وصفةٌ غيرُ سارية", () => {
    const r = computeConsumption([sold({ menuProductId: AMERICANO })], versions);
    expect(r.excluded[0].reason).toBe("NO_RECIPE");
  });

  it("وناتجُ الوصفة بلترٍ لا يُترجَم إلى عددِ أكواب — يُعلَن ولا يُفترَض واحداً", () => {
    const batch = indexRecipeVersions([
      version({ yieldQuantityMilli: 2000, yieldUnit: "L" }),
    ]);
    const r = computeConsumption([sold()], batch);
    expect(r.excluded[0].reason).toBe("UNSUPPORTED_YIELD_UNIT");
  });

  it("وناتجٌ بالحبّة يقسم — وصفةٌ تُنتج ٤ أكواب", () => {
    const batch = indexRecipeVersions([
      version({
        yieldQuantityMilli: 4000,
        yieldUnit: "PIECE",
        ingredients: [{ productId: COFFEE, quantityMilli: 80_000, unit: "G", prepLossBp: null }],
      }),
    ]);
    const r = computeConsumption([sold({ quantityMilli: 4000 })], batch);
    /* ٤ أكوابٍ من وصفةٍ ناتجُها ٤ = ٨٠ جراماً */
    expect(canonicalToQuantity(r.byIngredient.get(COFFEE)!.canonicalMilli, "G")).toBe(80);
  });

  it("ومكوّنٌ ذُكر بعائلتين يُعلَن تضاربُه ولا يُجمَع", () => {
    const clashing = indexRecipeVersions([
      version({ id: "va", menuProductId: LATTE }),
      version({
        id: "vb", recipeId: "r2", menuProductId: AMERICANO,
        ingredients: [{ productId: COFFEE, quantityMilli: 18_000, unit: "ML", prepLossBp: null }],
      }),
    ]);
    const r = computeConsumption(
      [sold({ menuProductId: LATTE }), sold({ menuProductId: AMERICANO })],
      clashing,
    );
    expect(r.byIngredient.get(COFFEE)!.unitConflict).toBe("ML");
  });
});
