import { describe, expect, it } from "vitest";
import { buildWasteBoard, entryCostMinor, type WasteEntry, type WasteRate } from "./waste-board";

const e = (over: Partial<WasteEntry>): WasteEntry => ({ productId: "milk", productName: "حليب", reason: "EXPIRED", quantityMilli: 2_000, unit: "L", ...over });
/* لترُ الحليب بستّة ريالات = 600 هللة = 600,000 مِلّي-هللة */
const rates = new Map<string, WasteRate>([
  ["milk", { rateMilliMinor: 600_000, baseUnit: "L" }],
  ["beans", { rateMilliMinor: null, baseUnit: "KG" }],
]);

describe("لوحة الهدر", () => {
  it("كلفة السجلّ = الكمّيّة × سعر الوحدة من آخر جرد", () => {
    expect(entryCostMinor(e({}), rates.get("milk"))).toBe(12_00);
  });

  it("ما لا سعر له، أو وحدته غير وحدة السعر، مجهول لا صفر", () => {
    expect(entryCostMinor(e({ productId: "beans", unit: "KG" }), rates.get("beans"))).toBeNull();
    expect(entryCostMinor(e({ productId: "syrup" }), undefined)).toBeNull();
    expect(entryCostMinor(e({ unit: "KG" }), rates.get("milk"))).toBeNull();
  });

  it("وحدة من العائلة نفسها تحوّل: 500 مل من صنف سعره باللتر", () => {
    expect(entryCostMinor(e({ quantityMilli: 500_000, unit: "ML" }), rates.get("milk"))).toBe(3_00);
  });

  it("المجموع لما عرف وحده، والمجهول يعدّ بجانبه في سببه", () => {
    const b = buildWasteBoard([
      e({}),
      e({ reason: "SPILLED", quantityMilli: 500 }),
      e({ productId: "beans", productName: "بنّ", unit: "KG", reason: "CALIBRATION" }),
    ], rates);
    expect(b.recordCount).toBe(3);
    expect(b.knownCostMinor).toBe(15_00);
    expect(b.unknownCount).toBe(1);
    expect(b.byReason).toEqual([
      { reason: "EXPIRED", count: 1, costMinor: 12_00, unknownCount: 0 },
      { reason: "SPILLED", count: 1, costMinor: 3_00, unknownCount: 0 },
      { reason: "CALIBRATION", count: 1, costMinor: 0, unknownCount: 1 },
    ]);
  });

  it("أكثر الأصناف هدراً ثلاثة بالكلفة المعروفة — وما جهلت كلفته لا يتصدّر بصفر", () => {
    const b = buildWasteBoard([e({}), e({}), e({ productId: "beans", productName: "بنّ", unit: "KG" })], rates);
    expect(b.topProducts).toEqual([{ productId: "milk", productName: "حليب", count: 2, costMinor: 24_00 }]);
  });

  it("«انتهت صلاحيّته» مرّتين لصنف إشارة، ومرّة ليست إشارة", () => {
    const b = buildWasteBoard([e({}), e({}), e({ productId: "beans", productName: "بنّ", unit: "KG" }), e({ reason: "SPILLED" })], rates);
    expect(b.repeatedExpiry).toEqual([{ productId: "milk", productName: "حليب", count: 2 }]);
  });

  it("بلا سجلّات: لوحة فارغة", () => {
    expect(buildWasteBoard([], rates)).toEqual({ recordCount: 0, knownCostMinor: 0, unknownCount: 0, byReason: [], topProducts: [], repeatedExpiry: [] });
  });
});
