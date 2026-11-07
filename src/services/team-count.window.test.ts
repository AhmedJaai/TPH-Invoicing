import { describe, expect, it } from "vitest";
import { teamCountWindow } from "./team-count.service";

/** جردُ السبت يُفتح للموظّف السبتَ والأحدَ بعده وحدهما، ولأسبوعٍ واحد: الذي ينتهي ذلك السبت. */
describe("teamCountWindow", () => {
  it("السبت: أسبوعُه هو (الأحد ← السبت)", () => {
    expect(teamCountWindow("2026-11-14")).toEqual({ open: true, week: { start: "2026-11-08", end: "2026-11-14" } });
  });
  it("الأحد بعده: الأسبوعُ الذي انتهى أمس — التقفيلةُ تعبر منتصف الليل", () => {
    expect(teamCountWindow("2026-11-15")).toEqual({ open: true, week: { start: "2026-11-08", end: "2026-11-14" } });
  });
  it("وسطُ الأسبوع مغلق، ويقول السبتَ القادم والأسبوعَ الماضي", () => {
    expect(teamCountWindow("2026-11-11")).toEqual({ open: false, nextSaturday: "2026-11-14", lastWeek: { start: "2026-11-01", end: "2026-11-07" } });
    expect(teamCountWindow("2026-11-09").open).toBe(false);
    expect(teamCountWindow("2026-11-13").open).toBe(false);
  });
});
