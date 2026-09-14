import { describe, expect, it } from "vitest";
import { isCalendarDate } from "./validate-extraction";

describe("التاريخ يومٌ في التقويم لا شكلُه", () => {
  it("يقبل اليوم الصحيح وفبراير الكبيسة", () => {
    expect(isCalendarDate("2026-09-14")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
  });

  it("يردّ الشهر الثالث عشر واليوم الذي ينقلب", () => {
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-9-14")).toBe(false);
  });
});
