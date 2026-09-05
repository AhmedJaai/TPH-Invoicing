import { describe, expect, it } from "vitest";
import { MAX_FEE_MINOR, MAX_FEE_RATIO, splitBankFee, splitGroupFee } from "./fees";

describe("splitBankFee", () => {
  it("الحالة التي ذكرها المراجع: فاتورة ٥٬٠٠٠ وخصم ٥٬٠٢٠", () => {
    const r = splitBankFee(5_020_00, 5_000_00)!;
    expect(r.allocatedMinor).toBe(5_000_00);
    expect(r.feeMinor).toBe(20_00);
    expect(r.reason).toContain("رسم التحويل");
  });

  it("النقص ليس رسماً — هو سدادٌ جزئيّ، وهما حالان مختلفان", () => {
    expect(splitBankFee(4_800_00, 5_000_00)).toBeNull();
  });

  it("التطابق التامّ لا رسم فيه", () => {
    expect(splitBankFee(5_000_00, 5_000_00)).toBeNull();
  });

  it("ما جاوز الحدّ فرقٌ حقيقيّ يُحقَّق فيه لا رسمٌ يُفترَض", () => {
    expect(splitBankFee(5_000_00 + MAX_FEE_MINOR + 1, 5_000_00)).toBeNull();
  });

  it("والحدّ نسبةٌ أيضاً — لا رسم بخمسة وسبعين على فاتورة بمئة", () => {
    const small = 100_00;
    const cap = Math.round(small * MAX_FEE_RATIO);
    expect(splitBankFee(small + cap, small)).not.toBeNull();
    expect(splitBankFee(small + cap + 1, small)).toBeNull();
  });

  it("فاتورة بصفر لا تُقسَم", () => {
    expect(splitBankFee(100, 0)).toBeNull();
  });
});

describe("splitGroupFee", () => {
  it("الرسم واحدٌ للحوالة لا لكل فاتورة", () => {
    const r = splitGroupFee(3_015_00, [
      { id: "a", outstandingMinor: 2_000_00 },
      { id: "b", outstandingMinor: 1_000_00 },
    ])!;
    expect(r.feeMinor).toBe(15_00);
    expect(r.allocations).toHaveLength(2);
    expect(r.allocations.reduce((s, a) => s + a.amountMinor, 0)).toBe(3_000_00);
  });

  it("والحدّ على المجموع", () => {
    expect(splitGroupFee(3_000_00 + MAX_FEE_MINOR + 1, [
      { id: "a", outstandingMinor: 3_000_00 },
    ])).toBeNull();
  });

  it("مجموعة فارغة لا تُقسَم", () => {
    expect(splitGroupFee(100, [])).toBeNull();
  });
});
