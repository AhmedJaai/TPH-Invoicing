import { describe, expect, it } from "vitest";
import { catalogItemsFromApi, catalogProductsFromApi } from "./catalog";

describe("كتالوجُ فودكس من الواجهة", () => {
  it("صنفُ المخزون: وحدةُ الصرف والمعامِل والكلفة كما في ملفّه", () => {
    const out = catalogItemsFromApi([
      { sku: "sk-0039", name: "كاسات ورق ٧ اونص", storage_unit: "كرتون", ingredient_unit: "حبة", storage_to_ingredient_factor: 1000, cost: 85 },
      { sku: "sk-0043", name: "Blend fusion", storage_unit: "كيلو", ingredient_unit: "جرام", storage_to_ingredient_factor: 1000, cost: 77.5 },
    ]);
    expect(out.issues).toEqual([]);
    expect(out.items[0]).toMatchObject({ itemSku: "sk-0039", baseUnit: "PIECE", packQuantityMilli: 1_000_000, packCostMinor: 8500 });
    expect(out.items[1]).toMatchObject({ baseUnit: "G", packCostMinor: 7750 });
  });

  it("المحذوفُ لا يدخل، وما لا يُقرأ يُقال بسببه ولا يُكتب بصفر", () => {
    const out = catalogItemsFromApi([
      { sku: "a", name: "محذوف", ingredient_unit: "جرام", storage_to_ingredient_factor: 1, cost: 1, deleted_at: "2026-09-01 00:00:00" },
      { sku: "b", name: "بلا كلفة", ingredient_unit: "جرام", storage_to_ingredient_factor: 1000, cost: null },
      { sku: "c", name: "وحدةٌ غريبة", ingredient_unit: "برميل", storage_to_ingredient_factor: 1, cost: 5 },
    ]);
    expect(out.rows).toBe(2);
    expect(out.items).toEqual([]);
    expect(out.issues.map((i) => i.reason)).toEqual(["كلفةٌ غير مقروءة", "وحدةُ صرفٍ غير معروفة"]);
  });

  it("الصنفُ المباع ووصفتُه: كمّيّةُ المكوّن بوحدة صرفه", () => {
    const { products, recipes } = catalogProductsFromApi([
      {
        sku: "sk-0002", name: "Espresso", price: 12, cost: null, is_active: true,
        ingredients: [
          { sku: "sk-0043", name: "Blend fusion", ingredient_unit: "جرام", pivot: { quantity: 18 } },
          { sku: "sk-0039", name: "كاسات", ingredient_unit: "حبة", pivot: { quantity: 1 } },
          { sku: "sk-9", name: "مكوّنٌ حُذف", ingredient_unit: "جرام", deleted_at: "2026-09-01 00:00:00", pivot: { quantity: 3 } },
          { sku: "sk-8", name: "بلا كمّيّة", ingredient_unit: "جرام", pivot: { quantity: 0 } },
        ],
      },
      { sku: "old", name: "صنفٌ حُذف", price: 5, deleted_at: "2026-08-01 00:00:00" },
    ]);
    expect(products.products).toEqual([{ productSku: "sk-0002", name: "Espresso", priceMinor: 1200, declaredCostMinor: null, isActive: true }]);
    expect(recipes.recipeLines.map((l) => [l.itemSku, l.quantityMilli, l.unit])).toEqual([["sk-0043", 18_000, "G"], ["sk-0039", 1_000, "PIECE"]]);
    expect(recipes.issues.map((i) => i.reason)).toEqual(["كمّيّةٌ غير مقروءة"]);
  });
});
