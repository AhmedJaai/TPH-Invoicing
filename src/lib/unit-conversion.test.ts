import { describe, expect, it } from "vitest";
import {
  UNIT_LABEL, canCompare, convert, sameFamily, unitPriceFromPack,
  type BaseUnit,
} from "./unit-conversion";

describe("التحويل داخل العائلة", () => {
  it("الوزن يتحوّل", () => {
    expect(convert(2, "KG", "GRAM")).toBe(2000);
    expect(convert(500, "GRAM", "KG")).toBe(0.5);
  });

  it("الحجم يتحوّل", () => {
    expect(convert(1.5, "LITER", "ML")).toBe(1500);
  });

  /*
    ولا جسر بين الوزن والحجم: لترُ الحليب ليس كيلواً، ولترُ الزيت أبعد.
    والكثافة تختلف بالصنف، فمعامِلٌ عامّ هنا يُنتج أرقاماً تبدو دقيقة
    وهي مخترَعة.
  */
  it("الوزن لا يتحوّل إلى حجم", () => {
    expect(convert(1, "LITER", "KG")).toBeNull();
    expect(convert(1, "GRAM", "ML")).toBeNull();
    expect(sameFamily("KG", "LITER")).toBe(false);
  });

  it("الحبّة لا تتحوّل إلى عبوة بلا حجمٍ معلوم", () => {
    expect(convert(12, "PACK", "PIECE")).toBeNull();
  });

  it("الوحدة إلى نفسها تمرّ", () => {
    for (const u of Object.keys(UNIT_LABEL) as BaseUnit[]) {
      expect(convert(3, u, u)).toBe(3);
    }
  });
});

describe("سعر الوحدة من سعر العبوة", () => {
  /*
    المورّد يبيع «كرتون ١٢ × ١ لتر» والمقهى يقيس باللتر. وبلا تحويل
    يبدو أنّ السعر ارتفع اثني عشر ضعفاً.
  */
  it("كرتون ١٢ × ١ لتر بمئة ريال = ٨٫٣٣ لليتر", () => {
    const r = unitPriceFromPack(100_00, { packSize: 12, contentUnit: "LITER", contentQuantity: 1 }, "LITER")!;
    expect(r.baseQuantity).toBe(12);
    expect(r.unitPriceMinor).toBe(833);
    expect(r.explanation).toContain("12");
  });

  it("والسعر عددٌ صحيح بالهللات دائماً", () => {
    const r = unitPriceFromPack(100_00, { packSize: 3, contentUnit: "KG", contentQuantity: 1 }, "KG")!;
    expect(Number.isInteger(r.unitPriceMinor)).toBe(true);
    expect(r.unitPriceMinor).toBe(3333);
  });

  it("يعبر الوحدات داخل العائلة", () => {
    // ٦ عبوات × ٥٠٠ جرام = ٣ كيلو
    const r = unitPriceFromPack(60_00, { packSize: 6, contentUnit: "GRAM", contentQuantity: 500 }, "KG")!;
    expect(r.baseQuantity).toBe(3);
    expect(r.unitPriceMinor).toBe(2000);
  });

  /* المجهول لا يُحوَّل ولا يُفترَض واحداً */
  it("حجم العبوة المجهول يُرَدّ لا يُفترَض", () => {
    expect(unitPriceFromPack(100_00, { packSize: null, contentUnit: "LITER", contentQuantity: 1 }, "LITER"))
      .toBeNull();
    expect(unitPriceFromPack(100_00, { packSize: 12, contentUnit: null, contentQuantity: 1 }, "LITER"))
      .toBeNull();
    expect(unitPriceFromPack(100_00, { packSize: 0, contentUnit: "LITER", contentQuantity: 1 }, "LITER"))
      .toBeNull();
  });

  it("ولا يُحوَّل عبر العائلات", () => {
    expect(unitPriceFromPack(100_00, { packSize: 12, contentUnit: "LITER", contentQuantity: 1 }, "KG"))
      .toBeNull();
  });
});

describe("هل يصحّ أن يُقارَنا؟", () => {
  const p = (unit: BaseUnit | null, price: number | null) =>
    ({ supplierProductId: "x", unitPriceMinor: price, baseUnit: unit });

  it("الوحدتان من عائلةٍ واحدة تُقارَنان", () => {
    expect(canCompare(p("KG", 1000), p("GRAM", 1)).comparable).toBe(true);
  });

  /* الجواب «لا» ليس عجزاً — هو منعُ رقمٍ كاذب */
  it("عائلتان مختلفتان لا تُقارَنان", () => {
    const v = canCompare(p("LITER", 800), p("KG", 3000));
    expect(v.comparable).toBe(false);
    expect(v.reason).toContain("عائلتان");
  });

  it("والمجهول لا يُقارَن", () => {
    expect(canCompare(p("KG", null), p("KG", 100)).comparable).toBe(false);
    expect(canCompare(p(null, 100), p("KG", 100)).comparable).toBe(false);
  });
});
