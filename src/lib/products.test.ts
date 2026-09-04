import { describe, expect, it } from "vitest";
import { suggestCanonicalName, suggestCategory, suggestMerges, type SupplierItem } from "./products";

const item = (
  supplierId: string, supplierName: string, normalized: string,
  displayName: string, lastUnitPriceMinor: number, orderCount = 5,
): SupplierItem => ({ supplierId, supplierName, normalized, displayName, lastUnitPriceMinor, orderCount });

describe("suggestMerges", () => {
  it("لا يقترح لصنف عند مورّد واحد", () => {
    expect(suggestMerges([item("s1", "أ", "حليب", "حليب", 900)])).toHaveLength(0);
  });

  it("يقترح جمع الاسم الواحد عند مورّدين", () => {
    const s = suggestMerges([
      item("s1", "أ", "حليب 2 l", "حليب ٢ لتر", 900),
      item("s2", "ب", "حليب 2 l", "Milk 2L", 850),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].strength).toBe("STRONG");
    expect(s[0].caveats).toHaveLength(0);
  });

  it("«العنب» يُقترح ضعيفاً مع بيان سببه — لا يُجمع بصمت", () => {
    const s = suggestMerges([
      item("s1", "المحمصة الغربية", "عنب", "عنب", 15_500),
      item("s2", "لافا كمبوتشا", "عنب", "عنب", 1_350),
    ]);
    expect(s[0].strength).toBe("WEAK");
    expect(s[0].priceRatio).toBeGreaterThan(10);
    expect(s[0].caveats.join(" ")).toContain("صنفان مختلفان");
  });

  it("الاسم من كلمة واحدة يُضعِف الاقتراح", () => {
    const s = suggestMerges([
      item("s1", "أ", "سكر", "سكر", 1_000),
      item("s2", "ب", "سكر", "سكر", 1_050),
    ]);
    expect(s[0].strength).toBe("WEAK");
    expect(s[0].caveats.join(" ")).toContain("كلمة واحدة");
  });

  it("الطلب مرّة واحدة يُضعِف الاقتراح", () => {
    const s = suggestMerges([
      item("s1", "أ", "حليب طازج 2 l", "حليب طازج", 900, 10),
      item("s2", "ب", "حليب طازج 2 l", "Fresh Milk", 880, 1),
    ]);
    expect(s[0].caveats.join(" ")).toContain("مرّة واحدة");
  });

  it("يرتّب الأقوى أوّلاً", () => {
    const s = suggestMerges([
      item("s1", "أ", "عنب", "عنب", 15_500),
      item("s2", "ب", "عنب", "عنب", 1_350),
      item("s3", "ج", "حليب طازج 2 l", "حليب طازج ٢ لتر", 900),
      item("s4", "د", "حليب طازج 2 l", "Fresh Milk 2L", 880),
    ]);
    expect(s[0].strength).toBe("STRONG");
    expect(s[1].strength).toBe("WEAK");
  });

  it("يرتّب الأصناف داخل الاقتراح بالأرخص", () => {
    const s = suggestMerges([
      item("s1", "أ", "بن اثيوبي 1 kg", "بن إثيوبي", 9_000),
      item("s2", "ب", "بن اثيوبي 1 kg", "Ethiopia 1KG", 8_800),
    ]);
    expect(s[0].items[0].supplierName).toBe("ب");
  });

  it("بلا أسعار مسجّلة: لا يُخترع فارق، ويُقال إنّه لا دليل", () => {
    const s = suggestMerges([
      item("s1", "أ", "عينه مجانيه", "عينة", 0),
      item("s2", "ب", "عينه مجانيه", "عينة", 0),
    ]);
    expect(s).toHaveLength(1);
    expect(Number.isFinite(s[0].priceRatio)).toBe(true);
    expect(s[0].strength).toBe("WEAK");
    expect(s[0].caveats.join(" ")).toContain("لا أسعار");
  });
});

describe("suggestCanonicalName", () => {
  it("يختار أوفى الأسماء وصفاً", () => {
    expect(
      suggestCanonicalName([
        { supplierId: "a", supplierName: "أ", normalized: "x", displayName: "حليب", lastUnitPriceMinor: 1, orderCount: 1 },
        { supplierId: "b", supplierName: "ب", normalized: "x", displayName: "حليب طازج كامل الدسم ٢ لتر", lastUnitPriceMinor: 1, orderCount: 1 },
      ]),
    ).toBe("حليب طازج كامل الدسم ٢ لتر");
  });

  it("قائمة فارغة تعطي نصّاً فارغاً لا خطأً", () => {
    expect(suggestCanonicalName([])).toBe("");
  });
});

describe("suggestCategory", () => {
  it("يتعرّف على البنّ والألبان والتغليف والمشروبات", () => {
    expect(suggestCategory("Blend Fusion Medium Roast 1KG")).toBe("COFFEE");
    expect(suggestCategory("حليب كامل الدسم")).toBe("DAIRY");
    expect(suggestCategory("كاسات 12 اونز")).toBe("PACKAGING");
    expect(suggestCategory("كمبوتشا عنب")).toBe("BEVERAGE");
    expect(suggestCategory("مطهر أرضيات")).toBe("CLEANING");
  });

  it("ما لا دلالة فيه يبقى «أخرى» — لا يُخمَّن", () => {
    expect(suggestCategory("صنف غير معروف ٣٤٥")).toBe("OTHER");
  });
});
