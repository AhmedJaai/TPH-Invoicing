import { describe, expect, it } from "vitest";
import { BUSINESS_HOURS, errorBp, nowcastDay, type HourForecast } from "./nowcast";

const flat: HourForecast[] = BUSINESS_HOURS.map((hour) => ({ hour, p10: 50, p50: 100, p90: 150 }));

describe("nowcastDay — ما بيع + المتوقَّع لما بقي", () => {
  it("قبل أن يُفتح المقهى: المتوقَّعُ كلُّه تنبّؤ", () => {
    const n = nowcastDay(flat, new Map(), 5);
    expect(n).toMatchObject({ soldMinor: 0, p50: 2400, p10: 1200, p90: 3600, elapsedShare: 0 });
  });

  it("ما مضى من الساعات واقعٌ لا تنبّؤ — ولا يُصحَّح الباقي بنسبة الصباح", () => {
    const actual = new Map([[7, 300], [8, 300]]); // صباحٌ بثلاثة أضعاف المتوقَّع
    const n = nowcastDay(flat, actual, 9);
    expect(n.soldMinor).toBe(600);
    expect(n.p50).toBe(600 + 20 * 100); // الباقي كما هو: ٢٠ ساعة × ١٠٠ (يومُ العمل يبدأ الخامسة)
    expect(n.elapsedShare).toBeCloseTo(400 / 2400);
  });

  it("الساعةُ الجارية: ما بيع فيها حدٌّ أدنى لها", () => {
    const n = nowcastDay(flat, new Map([[20, 130]]), 20);
    // الثامنةُ مساءً الـ١٦ في يوم العمل (من الخامسة): ١٥ ساعة مضت بلا بيع، والجارية باعت ١٣٠ (> المتوقَّع ١٠٠)
    expect(n.soldMinor).toBe(130);
    expect(n.p50).toBe(130 + 0 + 8 * 100);
    expect(n.p90).toBe(130 + 20 + 8 * 150);
  });

  it("بعد منتصف الليل آخرُ اليوم لا أوّلُه", () => {
    const n = nowcastDay(flat, new Map([[23, 100], [0, 100]]), 1);
    expect(n.p50).toBe(200 + 4 * 100);
  });

  it("مدى الباقي بنسبة مدى اليوم لا بمجموع حدود الساعات", () => {
    const zeros = BUSINESS_HOURS.map((hour) => ({ hour, p10: 0, p50: 100, p90: 300 }));
    const n = nowcastDay(zeros, new Map([[7, 100]]), 8, { p10: 1800, p50: 2400, p90: 3000 });
    expect(n.p50).toBe(100 + 21 * 100);
    expect(n.p10).toBe(100 + Math.round(2100 * 0.75));
    expect(n.p90).toBe(100 + Math.round(2100 * 1.25));
  });

  it("الحدودُ مرتّبة دائماً", () => {
    const n = nowcastDay(flat, new Map([[12, 999]]), 15);
    expect(n.p10).toBeLessThanOrEqual(n.p50);
    expect(n.p50).toBeLessThanOrEqual(n.p90);
  });
});

describe("errorBp", () => {
  it("بالنقطة الأساس، وبلا مبيعاتٍ مجهول", () => {
    expect(errorBp(110, 100)).toBe(1000);
    expect(errorBp(90, 100)).toBe(-1000);
    expect(errorBp(50, 0)).toBeNull();
  });
});
