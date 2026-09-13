import { describe, expect, it } from "vitest";
import { currentMonthRiyadh, dayOfMonthRiyadh, todayInRiyadh } from "./riyadh-time";

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
