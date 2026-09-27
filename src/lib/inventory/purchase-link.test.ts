import { describe, expect, it } from "vitest";
import { guessPackSpec, suggestStockItem } from "./purchase-link";

describe("guessPackSpec — ما في الوحدة الواحدة من نصّ البند", () => {
  it("رونة كما في الإنتاج: «1 كيلو اوغندا اميولو مقطرة اكياس بيضاء»", () => {
    expect(guessPackSpec("1 كيلو اوغندا اميولو مقطرة اكياس بيضاء اضافة استيكرات"))
      .toEqual({ packSize: "1", contentQuantity: "1", contentUnit: "KG" });
  });

  it("كرتونٌ فيه عبوات: «12 × 1 لتر» و«24x250ml»", () => {
    expect(guessPackSpec("حليب المراعي 12 × 1 لتر")).toEqual({ packSize: "12", contentQuantity: "1", contentUnit: "L" });
    expect(guessPackSpec("Water 24x250ml")).toEqual({ packSize: "24", contentQuantity: "250", contentUnit: "ML" });
  });

  it("الأرقامُ العربيّة والوحدةُ الملتصقة", () => {
    expect(guessPackSpec("سكر ٥كجم")).toEqual({ packSize: "1", contentQuantity: "5", contentUnit: "KG" });
    expect(guessPackSpec("كريمة 500مل")).toEqual({ packSize: "1", contentQuantity: "500", contentUnit: "ML" });
  });

  it("لا تخمين حيث لا وحدة — المجهولُ لا يُفترَض", () => {
    expect(guessPackSpec("كروسان زبدة")).toBeNull();
    expect(guessPackSpec("SI-0034 كيك")).toBeNull();
  });
});

describe("suggestStockItem — أقربُ صنفٍ اسماً", () => {
  const options = [
    { id: "esp", nameAr: "بن اوغندا اميولو" },
    { id: "milk", nameAr: "حليب كامل الدسم" },
    { id: "sugar", nameAr: "سكر أبيض" },
  ];

  it("الكلماتُ المشتركة تُرجّح", () => {
    expect(suggestStockItem("1 كيلو اوغندا اميولو مقطرة اكياس بيضاء", options)?.id).toBe("esp");
    expect(suggestStockItem("حليب المراعي 12 × 1 لتر", options)?.id).toBe("milk");
  });

  it("لا اقتراح بلا كلمةٍ مشتركة", () => {
    expect(suggestStockItem("كروسان زبدة", options)).toBeNull();
  });
});

describe("suggestStockItem — يتعلّم من الربط السابق", () => {
  it("اسمُ المورّد الآخر يُقترح له ما رُبط به اسمٌ يشبهه", () => {
    const options = [
      { id: "eth", nameAr: "بن اثيوبي", aliases: ["[100791] Ethiopia Guji – Medium Roast 1 KG / إثيوبيا قوجي – وسط كجم"] },
      { id: "col", nameAr: "بن كولومبي" },
    ];
    expect(suggestStockItem("Ethiopia Guji Coffee 1000g", options)?.id).toBe("eth");
    expect(suggestStockItem("اثيوبيا قوجي كيلو", options)?.id).toBe("eth");
  });
});
