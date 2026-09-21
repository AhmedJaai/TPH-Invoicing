import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  declaredCostDisagrees, packUnitCostMilliMinor, recipeCost, type CostedIngredient,
} from "./recipe-cost";
import { parseCatalogFile } from "./foodics-catalog";
import { toMinor } from "./foodics-catalog";

/**
 * كلفةُ الوصفة — على كتالوج المقهى الحقيقيّ.
 *
 * ولا تُقرأ من `ingredient_cost` الذي يحمله الملفّ: **الخادم يحسب
 * المال**. والمقابلةُ بحسابه دليلُ فهمٍ لا بديلٌ عن الحساب.
 */
const ITEMS = parseCatalogFile(readFileSync("src/test/fixtures/foodics-inventory-items.csv")).items;
const LINES = parseCatalogFile(readFileSync("src/test/fixtures/foodics-product-ingredients.csv")).recipeLines;
const PRODUCTS = parseCatalogFile(readFileSync("src/test/fixtures/foodics-products.csv")).products;

const itemBySku = new Map(ITEMS.map((i) => [i.itemSku, i] as const));

/** مكوّناتُ صنفٍ مباعٍ كما ستصل الدالّةَ بعد الاستيراد. */
function ingredientsOf(productSku: string): CostedIngredient[] {
  return LINES.filter((l) => l.productSku === productSku).map((l) => {
    const item = itemBySku.get(l.itemSku)!;
    return {
      productId: l.itemSku,
      name: item.name,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      baseUnit: item.baseUnit,
      packMilli: item.packQuantityMilli,
      packCostMinor: item.packCostMinor,
    };
  });
}

describe("كلفةُ الوصفة من عبوات مكوّناتها", () => {
  it("«لاتيه مثلّج»: بنٌّ وحليبٌ ومصّاصةٌ وكاس = ‏٢٫٦٩ ريالاً", () => {
    const cost = recipeCost(ingredientsOf("sk-0009"));
    expect(cost.costMilliMinor).toBe(268_868);
    expect(cost.costMinor).toBe(269);
    expect(cost.unknown).toEqual([]);
    expect(cost.lines).toHaveLength(4);
  });

  it("و«سبانيش لاتيه ساخن» ستّةُ مكوّناتٍ = ‏٤٫٩٤", () => {
    expect(recipeCost(ingredientsOf("sk-0056")).costMinor).toBe(494);
  });

  /*
    ── والمجهولُ يُنشر ولا يُبتَلع ──

    مكوّنٌ بلا عبوةٍ معروفة يجعل مجموعَ وصفته `null`، ويُسمّى في
    `unknown`. ولو جُمع ما عداه لخرج رقمٌ يبدو دقيقاً وهو أقلُّ من
    الحقّ — ثمّ يُبنى عليه هامشٌ يبدو مريحاً.
  */
  it("ومكوّنٌ بلا كلفةٍ يجعل مجموعَ وصفته مجهولاً — ويُسمّى", () => {
    const ings = ingredientsOf("sk-0009");
    ings[1] = { ...ings[1], packCostMinor: null };
    const cost = recipeCost(ings);

    expect(cost.costMinor).toBeNull();
    expect(cost.unknown).toEqual([ings[1].name]);
    /* وما عُرف يبقى معروضاً في سطره — فيُعرَف موضعُ النقص */
    expect(cost.lines.filter((l) => l.costMilliMinor !== null)).toHaveLength(3);
    expect(cost.lines.find((l) => l.reason === "NO_COST")!.name).toBe(ings[1].name);
  });

  it("ووحدةٌ من عائلةٍ أخرى تُعلَن ولا تُحسَب صفراً", () => {
    const ings = ingredientsOf("sk-0009");
    const coffee = ings.findIndex((i) => i.unit === "G");
    ings[coffee] = { ...ings[coffee], baseUnit: "L" };
    const cost = recipeCost(ings);
    expect(cost.costMinor).toBeNull();
    expect(cost.lines[coffee].reason).toBe("UNIT_MISMATCH");
  });

  it("ووصفةٌ بلا مكوّناتٍ كلفتُها صفرٌ معروف لا مجهول", () => {
    expect(recipeCost([]).costMinor).toBe(0);
  });

  it("وكلفةُ وحدةِ الأساس تُحسَب من العبوة — ‏٢٫١٢٥ هللة للمصّاصة", () => {
    const straws = itemBySku.get("sk-0007")!;
    expect(packUnitCostMilliMinor(straws.packQuantityMilli, straws.packCostMinor)).toBe(2_125);
    expect(packUnitCostMilliMinor(null, 8_500)).toBeNull();
    expect(packUnitCostMilliMinor(0, 8_500)).toBeNull();
  });
});

describe("الكلفةُ المعلَنة تكشف الوصفةَ الناقصة", () => {
  /*
    ── ستّةُ أصنافٍ وصفتُها تغليفٌ فقط ──

    كلُّها حلوياتٌ ومشروبٌ معلَّب: تُحسَب لها الشوكةُ والعلبةُ والكاس،
    **ولا يُحسَب الصنفُ نفسُه**. فمبيعُها لا يُخصَم من المخزون، ويظهر
    ما اشتُري منها كلُّه «فرقاً» في آخر الأسبوع — وهو فرقٌ مصدرُه
    وصفةٌ ناقصة لا فاقدٌ وقع.
  */
  it("‏٦ أصنافٍ كلفتُها المعلَنة تُباعد مجموعَ وصفتها", () => {
    const off: string[] = [];
    for (const p of PRODUCTS) {
      const lines = LINES.filter((l) => l.productSku === p.productSku);
      if (lines.length === 0) continue;
      const cost = recipeCost(ingredientsOf(p.productSku));
      if (declaredCostDisagrees(cost.costMinor, p.declaredCostMinor)) off.push(p.name);
    }
    expect(off.sort()).toEqual([
      "Crunchy cake", "Dolce", "Kombucha", "Madrid Cheesecake", "Tiramisu", "Truffle mango",
    ]);
  });

  it("و«تشيز مدريد» وصفتُه ٠٫٧٦ والمعلَنة ٩٫١٧ — والكعكةُ ليست فيها", () => {
    const cost = recipeCost(ingredientsOf("sk-0023"));
    expect(cost.costMinor).toBe(76);
    expect(cost.lines.map((l) => l.name)).toEqual(["شوك", "علب تيكاوي"]);
    const declared = PRODUCTS.find((p) => p.productSku === "sk-0023")!.declaredCostMinor;
    expect(declared).toBe(917);
    expect(declaredCostDisagrees(cost.costMinor, declared)).toBe(true);
  });

  /*
    والحدُّ نسبةٌ لا مبلغ: ريالٌ في وصفةٍ بريالين خبر، وريالٌ في وصفةٍ
    بأربعين تقريبُ مورّد.
  */
  it("وفارقٌ صغير نسبةً لا يُرفَع — ولا يُحكَم على ما لا كلفةَ معلَنةً له", () => {
    expect(declaredCostDisagrees(1_000, 1_050)).toBe(false);
    expect(declaredCostDisagrees(1_000, 2_000)).toBe(true);
    expect(declaredCostDisagrees(null, 900)).toBe(false);
    expect(declaredCostDisagrees(900, null)).toBe(false);
    expect(declaredCostDisagrees(900, 0)).toBe(false);
  });

  /*
    ── والتقريبُ مرّةً في النهاية ──

    أربعُ مصّاصاتٍ بـ٢٫١٢٥ هللةٍ لكلٍّ = ‏٨٫٥ هللات، تُقرَّب إلى ٩.
    ولو قُرِّب كلُّ سطرٍ على حدةٍ لصار ٢+٢+٢+٢ = ‏٨ — تضيع هللةٌ في
    أربعة أسطر، وتضيع مئاتٌ في وصفاتِ أسبوع.
  */
  it("والتقريبُ مرّةً في النهاية لا مرّةً لكلّ سطر", () => {
    const straw = itemBySku.get("sk-0007")!;
    const one: CostedIngredient = {
      productId: straw.itemSku, name: straw.name,
      quantityMilli: 1_000, unit: "PIECE", baseUnit: straw.baseUnit,
      packMilli: straw.packQuantityMilli, packCostMinor: straw.packCostMinor,
    };
    const cost = recipeCost([one, { ...one }, { ...one }, { ...one }]);

    expect(cost.costMilliMinor).toBe(8_500);
    expect(cost.costMinor).toBe(9);
    expect(cost.lines.reduce((s, l) => s + toMinor(l.costMilliMinor!), 0)).toBe(8);
  });
});
