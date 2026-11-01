import { describe, expect, it } from "vitest";
import { CADENCES, CADENCE_MONTHS, asCadence, monthlyShareOf } from "./cadence";

describe("الدورة", () => {
  it("كلُّ دورةٍ لها أشهرُها، والنصفُ سنويّ ستّة", () => {
    expect(CADENCES.map((c) => CADENCE_MONTHS[c])).toEqual([1, 3, 6, 12]);
  });

  it("ما لا يُعرف شهريّ — كما كان قبل أن تُضاف الدورة", () => {
    expect(asCadence("SEMIANNUAL")).toBe("SEMIANNUAL");
    expect(asCadence("WEEKLY")).toBe("MONTHLY");
    expect(asCadence("")).toBe("MONTHLY");
  });

  it("حصّةُ الشهر من إيجار ٤٧٬٥٠٠ كلَّ ستّة أشهر: ٧٬٩١٦٫٦٧ بالهللة الصحيحة", () => {
    expect(monthlyShareOf(47_500_00, "SEMIANNUAL")).toBe(791_667);
    expect(monthlyShareOf(1_200_00, "MONTHLY")).toBe(1_200_00);
    expect(monthlyShareOf(300_00, "QUARTERLY")).toBe(100_00);
    expect(monthlyShareOf(1_200_00, "ANNUAL")).toBe(100_00);
  });
});
