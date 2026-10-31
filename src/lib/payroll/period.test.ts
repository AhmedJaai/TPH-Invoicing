import { describe, expect, it } from "vitest";
import { deductionMonthOf, deductionPeriod, inDeductionPeriod } from "./period";

describe("فترةُ الخصم — من ٢٧ الشهر السابق إلى ٢٦ منه (قرار أحمد)", () => {
  it("راتبُ نوفمبر يُحسم منه ما بين ٢٧ أكتوبر و٢٦ نوفمبر", () => {
    expect(deductionPeriod("2026-11")).toEqual({ from: "2026-10-27", to: "2026-11-26" });
    expect(deductionPeriod("2027-01")).toEqual({ from: "2026-12-27", to: "2027-01-26" });
    expect(deductionPeriod("2027-03")).toEqual({ from: "2027-02-27", to: "2027-03-26" });
  });
  it("يومُ ٢٧ فما بعده لراتب الشهر القادم، وما قبله لشهره", () => {
    expect(inDeductionPeriod("2026-10-27", "2026-11")).toBe(true);
    expect(inDeductionPeriod("2026-10-26", "2026-11")).toBe(false);
    expect(inDeductionPeriod("2026-11-26", "2026-11")).toBe(true);
    expect(deductionMonthOf("2026-10-26")).toBe("2026-10");
    expect(deductionMonthOf("2026-10-27")).toBe("2026-11");
    expect(deductionMonthOf("2026-12-31")).toBe("2027-01");
    expect(deductionMonthOf("2027-02-28")).toBe("2027-03");
  });
});
