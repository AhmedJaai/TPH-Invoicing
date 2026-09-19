import { describe, expect, it } from "vitest";
import {
  currentMonthRiyadh, dayOfMonthRiyadh, formatDay, formatMonth, formatRange, todayInRiyadh,
} from "./riyadh-time";

describe("الشهر بتوقيت الرياض", () => {
  it("الواحدة والنصف فجراً في أوّل سبتمبر بالرياض هي سبتمبر — وUTC يقول أغسطس", () => {
    const at = new Date("2026-08-31T22:30:00Z");
    expect(at.toISOString().slice(0, 7)).toBe("2026-08");
    expect(currentMonthRiyadh(at)).toBe("2026-09");
    expect(todayInRiyadh(at)).toBe("2026-09-01");
    expect(dayOfMonthRiyadh(at)).toBe(1);
  });

  it("الظهر يتّفق فيه التوقيتان", () => {
    expect(todayInRiyadh(new Date("2026-09-14T09:00:00Z"))).toBe("2026-09-14");
  });
});

describe("التاريخ كما يُقرأ", () => {
  it("اليوم بالاسم لا بصيغة ISO", () => {
    const day = formatDay(new Date("2026-09-14T09:00:00Z"));
    expect(day).toContain("2026");
    expect(day).not.toContain("-");
  });

  it("الإقفال بعد منتصف الليل يبقى في يومه بالرياض", () => {
    // 2026-08-31T22:30:00Z هي الواحدة والنصف فجراً من أوّل سبتمبر بالرياض
    const at = new Date("2026-08-31T22:30:00Z");
    expect(formatDay(at)).toBe(formatDay(new Date("2026-09-01T09:00:00Z")));
    expect(formatDay(at)).not.toBe(formatDay(new Date("2026-08-31T09:00:00Z")));
  });

  it("سلسلة اليوم لا تُزاح يوماً", () => {
    expect(formatDay("2026-09-14")).toBe(formatDay(new Date("2026-09-14T09:00:00Z")));
  });

  it("المجهول شَرطة لا تاريخ مخترَع", () => {
    expect(formatDay(null)).toBe("—");
    expect(formatDay(undefined)).toBe("—");
    expect(formatDay("")).toBe("—");
  });

  it("الشهر باسمه", () => {
    expect(formatMonth("2026-08")).toContain("2026");
    expect(formatMonth("2026-08")).not.toBe("2026-08");
    // ما ليس شهراً يبقى كما هو ولا يُخترع له اسم
    expect(formatMonth("غير معروف")).toBe("غير معروف");
  });

  it("النطاق «من … إلى …» لا سهم", () => {
    const r = formatRange("2026-05-01", "2026-05-31");
    expect(r.startsWith("من ")).toBe(true);
    expect(r).toContain(" إلى ");
    expect(r).not.toContain("←");
    expect(r).not.toContain("→");
  });
});
