import { describe, expect, it } from "vitest";
import { buildRunway, type RunwayInput } from "./cash-runway";

const base: RunwayInput = { balanceMinor: 46_000_00, balanceAsOf: "2026-10-08", today: "2026-10-10", outflowMinor: 120_000_00, firstDay: "2026-08-10" };

describe("أيّام النقد الباقية", () => {
  it("الرصيدُ ÷ متوسّط الصادر اليوميّ — أيّامٌ كاملة بقسمةٍ صحيحة", () => {
    const r = buildRunway(base);
    expect(r.basisDays).toBe(60);
    expect(r.dailyOutflowMinor).toBe(2_000_00);
    expect(r.days).toBe(23);
    expect(r.blocked).toBeNull();
  });

  it("الكسرُ يُقطع ولا يُقرَّب إلى أعلى — يومٌ لم يكتمل ليس يوماً", () => {
    expect(buildRunway({ ...base, balanceMinor: 47_999_99 }).days).toBe(23);
  });

  it("رصيدٌ مجهول لا يُحسب له — لا صفر", () => {
    expect(buildRunway({ ...base, balanceMinor: null })).toMatchObject({ days: null, blocked: "NO_BALANCE" });
    expect(buildRunway({ ...base, balanceAsOf: null }).blocked).toBe("NO_BALANCE");
  });

  it("كشفٌ واقف أكثر من أسبوع يحجب الرقم، وأسبوعٌ بالضبط لا يحجبه", () => {
    expect(buildRunway({ ...base, today: "2026-10-16" }).blocked).toBe("STALE");
    expect(buildRunway({ ...base, today: "2026-10-15" }).blocked).toBeNull();
  });

  it("تاريخٌ أقصر من ثلاثين يوماً لا يُبنى عليه معدّل", () => {
    expect(buildRunway({ ...base, firstDay: "2026-09-20" })).toMatchObject({ days: null, blocked: "SHORT_HISTORY", basisDays: 19 });
    expect(buildRunway({ ...base, firstDay: null }).blocked).toBe("SHORT_HISTORY");
    expect(buildRunway({ ...base, firstDay: "2026-09-09", outflowMinor: 30_000_00 })).toMatchObject({ basisDays: 30, days: 46 });
  });

  it("بلا صادر لا قسمةَ على صفر", () => {
    expect(buildRunway({ ...base, outflowMinor: 0 }).blocked).toBe("NO_OUTFLOW");
  });

  it("رصيدٌ مكشوف يغطّي صفرَ يوم — صفرٌ معلوم", () => {
    expect(buildRunway({ ...base, balanceMinor: -5_00 }).days).toBe(0);
  });
});
