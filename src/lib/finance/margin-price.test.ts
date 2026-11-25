import { describe, expect, it } from "vitest";
import { priceForMargin, TARGET_MARGIN_BP } from "./margin-price";
import { netInsideGross } from "@/lib/vat";

describe("سعرُ الهامش", () => {
  it("كيكةٌ تُباع بـ٢٨ وكلفتُها ١٣٫٧٤: السعرُ الذي تصير به المكوّنات ٣٥٪ من الصافي", () => {
    // ١٥٩ حبّة بـ٤٬٤٥٢ ريالاً، وكلفتُها ٢٬١٨٤٫٧٤
    const p = priceForMargin({ salesMinor: 445_200, costMinor: 218_474, quantityMilli: 159_000, marginBp: 4_360 })!;
    expect(p.currentUnitMinor).toBe(2_800);
    expect(p.unitCostMinor).toBe(1_375);
    expect(p.targetUnitMinor % 100).toBe(0);
    // عند السعر المقترح لا يقع الهامشُ دون الهدف
    const net = netInsideGross(p.targetUnitMinor);
    expect(((net - p.unitCostMinor) * 10_000) / net).toBeGreaterThanOrEqual(TARGET_MARGIN_BP);
    // وريالٌ أقلّ منه يقع دونه — فهو أدنى سعرٍ تامّ
    const lower = netInsideGross(p.targetUnitMinor - 100);
    expect(((lower - p.unitCostMinor) * 10_000) / lower).toBeLessThan(TARGET_MARGIN_BP);
  });

  it("ما بلغ هامشُه الهدفَ لا يُقترح له سعر", () => {
    expect(priceForMargin({ salesMinor: 100_000, costMinor: 10_000, quantityMilli: 50_000, marginBp: 8_800 })).toBeNull();
  });

  it("بلا كلفةٍ أو بلا كمّيّة لا جواب — والمجهولُ لا يصير صفراً", () => {
    expect(priceForMargin({ salesMinor: 100_000, costMinor: null, quantityMilli: 50_000, marginBp: null })).toBeNull();
    expect(priceForMargin({ salesMinor: 100_000, costMinor: 5_000, quantityMilli: 0, marginBp: 1_000 })).toBeNull();
  });
});
