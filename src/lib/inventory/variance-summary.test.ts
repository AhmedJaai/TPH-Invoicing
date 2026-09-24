import { describe, expect, it } from "vitest";
import { combineSummaries, summariseVariance, type SummaryLine } from "./variance-summary";

/* ١٠٠ ريالٍ للكيلو = ١٠ هللات للجرام = ١٠٬٠٠٠ مِلّي‑هللة */
const RATE = 10_000;
const g = (n: number) => n * 1000; // جرامٌ بالمِلّي المعياريّ

function line(over: Partial<SummaryLine>): SummaryLine {
  return {
    inScope: true, varianceMilli: null, varianceCostMinor: null,
    theoreticalConsumptionMilli: null, unitCostMilliMinor: RATE, baseUnit: "G",
    ...over,
  };
}

describe("النقصُ والزيادةُ لا يتقاصّان", () => {
  it("نقصٌ بألفٍ وزيادةٌ بألف في أسبوعٍ واحد — الصافي صفر، والنقصُ ألفٌ والحجمُ ألفان", () => {
    const s = summariseVariance([
      line({ varianceMilli: -g(10_000), varianceCostMinor: -1000_00 }),
      line({ varianceMilli: g(10_000), varianceCostMinor: 1000_00 }),
    ]);
    expect(s.netCostMinor).toBe(0);
    expect(s.shortageCostMinor).toBe(1000_00);
    expect(s.overageCostMinor).toBe(1000_00);
    expect(s.absoluteCostMinor).toBe(2000_00);
    expect(s.linesShort).toBe(1);
    expect(s.linesOver).toBe(1);
  });

  it("وعبر أسبوعين كذلك — نقصُ الأوّل لا تُطفئه زيادةُ الثاني", () => {
    const w1 = summariseVariance([line({ varianceMilli: -g(10_000), varianceCostMinor: -1000_00 })]);
    const w2 = summariseVariance([line({ varianceMilli: g(10_000), varianceCostMinor: 1000_00 })]);
    const both = combineSummaries([w1, w2]);
    expect(both.netCostMinor).toBe(0);
    expect(both.shortageCostMinor).toBe(1000_00);
    expect(both.absoluteCostMinor).toBe(2000_00);
  });

  it("ونسبةُ النقص مقامُها كلفةُ الاستهلاك المتوقَّع", () => {
    /* استُهلك ٢٠ كجم بكلفة ٢٬٠٠٠ ريال، ونقص ما قيمتُه ١٠٠ ← ٥٪ */
    const s = summariseVariance([
      line({ theoreticalConsumptionMilli: g(20_000), varianceMilli: -g(1000), varianceCostMinor: -100_00 }),
    ]);
    expect(s.consumptionCostMinor).toBe(2000_00);
    expect(s.shortageRateBp).toBe(500);
    expect(s.consumptionCostComplete).toBe(true);
  });

  it("والخارجُ عن الجرد لا يدخل شيئاً", () => {
    const s = summariseVariance([
      line({ inScope: false, varianceMilli: -g(1000), varianceCostMinor: -100_00, theoreticalConsumptionMilli: g(5000) }),
    ]);
    expect(s.shortageCostMinor).toBe(0);
    expect(s.consumptionCostMinor).toBe(0);
    expect(s.shortageRateBp).toBeNull();
  });

  it("وفرقٌ بلا كلفة يُعَدّ ولا يُجمَع — ومقامٌ بلا كلفة يُعلَن ناقصاً", () => {
    const s = summariseVariance([
      line({ varianceMilli: -g(500), varianceCostMinor: null, unitCostMilliMinor: null, theoreticalConsumptionMilli: g(3000) }),
    ]);
    expect(s.linesWithoutCost).toBe(1);
    expect(s.shortageCostMinor).toBe(0);
    expect(s.consumptionCostComplete).toBe(false);
  });
});

describe("ما لم يُقَس غيرُ معروف — لا صفر", () => {
  const unmeasured: SummaryLine = {
    inScope: true, varianceMilli: null, varianceCostMinor: null,
    theoreticalConsumptionMilli: 36_000, unitCostMilliMinor: 5_000_000, baseUnit: "PIECE",
  };

  it("جردٌ لم يُحسَب فيه فرقُ صنفٍ واحد: لا نسبةَ نقصٍ تُقال صفراً", () => {
    const s = summariseVariance([unmeasured, { ...unmeasured }]);
    expect(s.linesMeasured).toBe(0);
    expect(s.shortageRateBp).toBeNull();
  });

  it("الفرقُ الصفرُ المحسوب قياسٌ — نسبتُه صفرٌ بحقّ", () => {
    const s = summariseVariance([{ ...unmeasured, varianceMilli: 0, varianceCostMinor: 0 }]);
    expect(s.linesMeasured).toBe(1);
    expect(s.shortageRateBp).toBe(0);
  });

  it("والخارجُ عن النطاق لا يُعدّ مقيساً", () => {
    const s = summariseVariance([{ ...unmeasured, inScope: false, varianceMilli: 0, varianceCostMinor: 0 }]);
    expect(s.linesMeasured).toBe(0);
  });
});

describe("نسبةُ النقص على ما عُدّ — لا على الجرد كلِّه", () => {
  it("صنفٌ عُدّ نقص منه ٥٫٦٪ وتسعةٌ لم تُعَدّ: النسبةُ ٥٫٦٪ لا ٠٫٦٪", () => {
    /* براوني: استُهلك ٣٦ بـ٦٫٦٠ = ٢٣٧٫٦٠، ونقص ٢ = ١٣٫٢٠ */
    const counted = line({
      baseUnit: "PIECE", unitCostMilliMinor: 660_000,
      theoreticalConsumptionMilli: 36_000, varianceMilli: -2_000, varianceCostMinor: -13_20,
    });
    const notCounted = line({ theoreticalConsumptionMilli: g(20_000) }); // ٢٬٠٠٠ ريال، لم يُعَدّ
    const s = summariseVariance([counted, ...Array.from({ length: 9 }, () => notCounted)]);
    expect(s.consumptionCostMinor).toBe(237_60);
    expect(s.shortageRateBp).toBe(556);
  });
});

