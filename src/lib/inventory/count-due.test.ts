import { describe, expect, it } from "vitest";
import { lateWeeklyCount } from "./count-due";
import { addDays } from "../riyadh-time";

const weekly = [
  { status: "FINALISED", periodStart: "2026-11-08", periodEnd: "2026-11-14" },
  { status: "FINALISED", periodStart: "2026-11-01", periodEnd: "2026-11-07" },
];

describe("جرد الأسبوع المتأخّر", () => {
  it("مسوّدةُ ١٥–٢١ نوفمبر يومَ الأربعاء ٢٥: متأخّرٌ أربعة أيّام", () => {
    expect(lateWeeklyCount("2026-11-25", [{ status: "DRAFT", periodStart: "2026-11-15", periodEnd: "2026-11-21" }, ...weekly], addDays))
      .toEqual({ weekStart: "2026-11-15", weekEnd: "2026-11-21", daysLate: 4, draft: true });
  });
  it("لم يُبدأ: يُقال بلا مسوّدة، وفي مهلة اليومين لا يُقال", () => {
    expect(lateWeeklyCount("2026-11-24", weekly, addDays)?.draft).toBe(false);
    expect(lateWeeklyCount("2026-11-22", weekly, addDays)).toBeNull();
  });
  it("أُقفل جردُه، أو لا عادةَ جردٍ أسبوعيّ: لا شيء", () => {
    expect(lateWeeklyCount("2026-11-25", [{ status: "FINALISED", periodStart: "2026-11-15", periodEnd: "2026-11-21" }, ...weekly], addDays)).toBeNull();
    expect(lateWeeklyCount("2026-11-25", weekly.slice(0, 1), addDays)).toBeNull();
  });
  it("السبتُ نفسه لم ينتهِ: يُنظر إلى الأسبوع الذي قبله", () => {
    expect(lateWeeklyCount("2026-11-28", weekly, addDays)?.weekEnd).toBe("2026-11-21");
  });
});
