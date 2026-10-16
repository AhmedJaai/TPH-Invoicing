import { describe, expect, it } from "vitest";
import { buildFlowItem, suspectCountJump, totalFlow, type FlowItemInput } from "./stock-flow";

/** بنٌّ بالجرام: ١٠٠ ريالٍ للكيلو = ١٠ هللات للجرام = ‎10_000‎ مِلّي‑هللة. */
const base: FlowItemInput = {
  productId: "p", name: "بنّ", baseUnit: "G",
  purchasedMilli: 20_000_000, purchasedMinor: 200_000, unmeasuredLines: 0, unmeasuredMinor: 0, everLinked: true,
  consumed: { milli: 12_000_000, salesMilli: 11_500_000, staffMilli: 600_000, refundsMilli: -100_000 },
  unitConflict: false, wasteMilli: 500_000,
  openingMilli: 5_000_000, closingMilli: 10_500_000,
  rateMilliMinor: 10_000, costBasis: "PERIOD_PURCHASES",
  witnessConsumedMilli: null, witnessWasteMilli: null, witnessPurchasedMilli: null,
};

describe("الفرق غير المفسّر", () => {
  it("افتتاحيّ + مشترى − مستهلك − هدر − ختاميّ", () => {
    const f = buildFlowItem(base);
    /* ٥ + ٢٠ − ١٢ − ٠٫٥ − ١٠٫٥ = ٢ كجم */
    expect(f.unexplainedMilli).toBe(2_000_000);
    expect(f.unexplainedMinor).toBe(20_000);
    expect(f.wasteMinor).toBe(5_000);
    expect(f.staffMinor).toBe(6_000);
    expect(f.missing).toEqual([]);
  });
  it("بلا عدّ في طرف لا فرق — يبقى «مشترى أكثر من المباع»", () => {
    const f = buildFlowItem({ ...base, openingMilli: null });
    expect(f.unexplainedMilli).toBeNull();
    expect(f.surplusMilli).toBe(7_500_000);
    expect(f.missing).toEqual(["NO_OPENING_COUNT"]);
  });
  it("صنف لم يربط به بند قطّ: مشترياته غير معروفة لا صفر", () => {
    const f = buildFlowItem({ ...base, purchasedMilli: 0, purchasedMinor: 0, everLinked: false });
    expect(f.purchasedKnownMilli).toBeNull();
    expect(f.unexplainedMilli).toBeNull();
    expect(f.surplusMilli).toBeNull();
    expect(f.missing).toContain("PURCHASES_UNLINKED");
  });
  it("وشاهد فودكس يسدّه باسمه", () => {
    const f = buildFlowItem({ ...base, purchasedMilli: 0, purchasedMinor: 0, everLinked: false, witnessPurchasedMilli: 20_000_000 });
    expect(f.unexplainedMilli).toBeNull();
    expect(f.witnessUnexplainedMilli).toBe(2_000_000);
  });
  it("مربوط أقلّ كثيراً ممّا في فودكس: نقص ربط لا «استهلاك فوق المتاح»", () => {
    const f = buildFlowItem({ ...base, purchasedMilli: 2_100_000, witnessPurchasedMilli: 20_000_000 });
    expect(f.purchasedKnownMilli).toBeNull();
    expect(f.unexplainedMilli).toBeNull();
    expect(f.missing).toEqual(["PURCHASES_BELOW_WITNESS"]);
    expect(f.witnessUnexplainedMilli).toBe(2_000_000);
  });
  it("وفودكس الأقلّ لا يسقط مشترياتنا — فواتيرنا الأصل", () => {
    const f = buildFlowItem({ ...base, witnessPurchasedMilli: 5_000_000 });
    expect(f.unexplainedMilli).toBe(2_000_000);
  });
  it("بند مربوط بلا مواصفة عبوة يخرج مشتريات صنفه كلّها إلى مجهول", () => {
    const f = buildFlowItem({ ...base, unmeasuredLines: 1, unmeasuredMinor: 45_000 });
    expect(f.purchasedKnownMilli).toBeNull();
    expect(f.missing).toContain("PURCHASES_UNMEASURED");
  });
  it("بلا وصفة: الاستهلاك مجهول", () => {
    const f = buildFlowItem({ ...base, consumed: null });
    expect(f.consumedMinor).toBeNull();
    expect(f.unexplainedMilli).toBeNull();
    expect(f.missing).toContain("NO_RECIPE");
  });
  it("فرق سالب يبقى سالباً — خطأ بيانات لا يطوى", () => {
    const f = buildFlowItem({ ...base, purchasedMilli: 10_000_000 });
    expect(f.unexplainedMilli).toBe(-8_000_000);
  });
  it("بلا كلفة: الكمّيّة معروفة والقيمة لا", () => {
    const f = buildFlowItem({ ...base, rateMilliMinor: null, costBasis: null });
    expect(f.unexplainedMilli).toBe(2_000_000);
    expect(f.unexplainedMinor).toBeNull();
  });
});

describe("الرقم المشكوك فيه", () => {
  it("ماتشا عدّت ٥٩٠ كيلو: فرق فوق عشرة أضعاف ما بيع يخرج ويسمّى", () => {
    const f = buildFlowItem({ ...base, name: "ماتشا", openingMilli: 590_000_000, consumed: { milli: 1_000_000, salesMilli: 1_000_000, staffMilli: 0, refundsMilli: 0 }, closingMilli: 500_000 });
    expect(f.unexplainedMilli).toBeNull();
    expect(f.missing).toEqual(["SUSPECT_ENTRY"]);
  });
  it("وفرق كبير بالنسبة صغير بالريال لا يشكّ فيه", () => {
    /* مصّاصات: فرقُ ثلاثمئة حبّةٍ بعشرة ريالات */
    const f = buildFlowItem({ ...base, baseUnit: "PIECE", rateMilliMinor: 2_125, purchasedMilli: 400_000, openingMilli: 0, closingMilli: 0, wasteMilli: 0, consumed: { milli: 20_000, salesMilli: 20_000, staffMilli: 0, refundsMilli: 0 } });
    expect(f.unexplainedMilli).toBe(380_000);
    expect(f.missing).toEqual([]);
  });
  it("قفزة العدّ: عشرون ضعفاً بألف ريال، أو من صفر بخمسة آلاف", () => {
    expect(suspectCountJump(1_000, 590_000, 65_000, 38_000_000)).toBe(true);
    /* بنٌّ نفد: من ستّة كيلو إلى صفر — حقّ */
    expect(suspectCountJump(6_675_000, 0, 60_000, 0)).toBe(false);
    /* سكّر «٥٬٥٠٠ كيلو» من لا شيء */
    expect(suspectCountJump(0, 5_500_000_000, 0, 1_650_000)).toBe(true);
    expect(suspectCountJump(5_000, 6_000, 50_000, 60_000)).toBe(false);
  });
});

describe("المجموع", () => {
  it("النقص والزيادة لا يتقاصّان", () => {
    const t = totalFlow([buildFlowItem(base), buildFlowItem({ ...base, productId: "q", purchasedMilli: 18_000_000 })]);
    expect(t.shortageMinor).toBe(20_000);
    expect(t.overageMinor).toBe(0);
    const u = totalFlow([buildFlowItem(base), buildFlowItem({ ...base, productId: "q", purchasedMilli: 16_000_000 })]);
    expect(u.shortageMinor).toBe(20_000);
    expect(u.overageMinor).toBe(-20_000);
  });
  it("بلا صنف مقيس المجاميع غير معروفة لا صفر", () => {
    const t = totalFlow([buildFlowItem({ ...base, openingMilli: null })]);
    expect(t.shortageMinor).toBeNull();
    expect(t.surplusNoCountMinor).toBe(75_000);
  });
});
