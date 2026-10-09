import { describe, expect, it } from "vitest";
import { findStatementTwin } from "./statement-twin";

const aug = { id: "s1", periodStart: "2026-08-01", periodEnd: "2026-08-31", closingBalanceMinor: 4_151_50 };

describe("findStatementTwin — الكشفُ نفسُه بملفٍّ آخر", () => {
  it("المدّةُ والرصيدُ نفساهما ← يشبهه", () => {
    expect(findStatementTwin([aug], { periodStart: "2026-08-01", periodEnd: "2026-08-31", closingBalanceMinor: 4_151_50 })).toBe(aug);
  });
  it("رصيدٌ لم يُقرأ في أحدهما لا ينفي التشابه", () => {
    expect(findStatementTwin([aug], { periodStart: "2026-08-01", periodEnd: "2026-08-31", closingBalanceMinor: null })).toBe(aug);
    expect(findStatementTwin([{ ...aug, closingBalanceMinor: null }], { periodStart: "2026-08-01", periodEnd: "2026-08-31", closingBalanceMinor: 1 })).not.toBeNull();
  });
  it("رصيدان مقروءان مختلفان، أو مدّةٌ أخرى ← كشفٌ آخر", () => {
    expect(findStatementTwin([aug], { periodStart: "2026-08-01", periodEnd: "2026-08-31", closingBalanceMinor: 9 })).toBeNull();
    expect(findStatementTwin([aug], { periodStart: "2026-05-01", periodEnd: "2026-08-31", closingBalanceMinor: 4_151_50 })).toBeNull();
  });
  it("ولا يشبه نفسَه", () => {
    expect(findStatementTwin([aug], { ...aug })).toBeNull();
  });
});
