import { describe, expect, it } from "vitest";
import { buildProductTrends, judgeTrend, MAX_WEEK_BP, toPoint, type TrendLine, type TrendPoint } from "./waste-trend";

const pt = (i: number, bp: number | null): TrendPoint => ({
  countId: `c${i}`, periodEnd: `2026-09-${String(10 + i).padStart(2, "0")}`,
  shortageBp: bp, shortageMilli: bp ?? 0, shortageCostMinor: bp === null ? null : bp, recordedWasteMilli: 0, partial: false,
});
const series = (...bps: (number | null)[]) => bps.map((bp, i) => pt(i, bp));

describe("judgeTrend — هل يتحسّن الفاقد؟", () => {
  it("أقلّ من أربعة أسابيع مقيسة: لا يكفي، ولا يُحكم من نقطتين", () => {
    expect(judgeTrend(series(900, 100)).verdict).toBe("TOO_FEW");
    expect(judgeTrend(series(900, null, 100, null, 50)).verdict).toBe("TOO_FEW");
    expect(judgeTrend(series(900, 800, 100)).measured).toBe(3);
  });
  it("النصفُ الأخير أقلّ بكثير: يتحسّن", () => {
    const j = judgeTrend(series(1200, 1000, 400, 200));
    expect(j).toMatchObject({ verdict: "IMPROVING", earlierBp: 1100, recentBp: 300, measured: 4 });
  });
  it("النصفُ الأخير أكبر بكثير: يسوء", () => {
    expect(judgeTrend(series(200, 300, 900, 1100)).verdict).toBe("WORSENING");
  });
  it("تغيّرٌ دون نصف نقطةٍ مئويّة أو دون خمسة عشر بالمئة: ثابت", () => {
    expect(judgeTrend(series(1000, 1000, 1100, 1100)).verdict).toBe("STEADY");
    expect(judgeTrend(series(0, 0, 40, 30)).verdict).toBe("STEADY");
  });
  it("أسبوعٌ شاذّ في الوسط (عدد خاطئ) لا يقلب الحكم، والنسبةُ فوق المئة تُقصّ", () => {
    expect(judgeTrend(series(500, 500, 99_999, 500, 500)).verdict).toBe("STEADY");
    expect(judgeTrend(series(500, 500, 500, 99_999)).recentBp).toBe(Math.round((500 + MAX_WEEK_BP) / 2));
  });
  it("الأسابيعُ غير المقيسة تُترك ولا تُعدّ صفراً، والترتيبُ بتاريخها لا بموضعها", () => {
    const shuffled = [pt(3, 100), pt(0, 900), pt(2, 150), pt(1, 800)];
    expect(judgeTrend(shuffled).verdict).toBe("IMPROVING");
    const gaps = series(900, null, 800, null, 100, 120);
    expect(judgeTrend(gaps)).toMatchObject({ verdict: "IMPROVING", measured: 4 });
  });
});

const line = (productId: string, i: number, over: Partial<TrendLine>): TrendLine => ({
  productId, productName: productId, category: "COFFEE", baseUnit: "G" as const, countId: `c${i}`,
  periodEnd: `2026-09-${String(10 + i).padStart(2, "0")}`, varianceMilli: -100, varianceConsumptionBp: -500,
  varianceCostMinor: -250, recordedWasteMilli: 0, partial: false, ...over,
});

describe("toPoint — النقصُ وحده يُقاس", () => {
  it("الزيادةُ ليست فاقداً، وغيرُ المقيس مجهولٌ لا صفر", () => {
    expect(toPoint(line("a", 0, { varianceMilli: 300, varianceConsumptionBp: 400, varianceCostMinor: 90 })))
      .toMatchObject({ shortageBp: 0, shortageMilli: 0, shortageCostMinor: 0 });
    expect(toPoint(line("a", 0, { varianceMilli: null, varianceConsumptionBp: null, varianceCostMinor: null })))
      .toMatchObject({ shortageBp: null, shortageCostMinor: null });
    expect(toPoint(line("a", 0, { varianceMilli: -40, varianceConsumptionBp: -700 }))).toMatchObject({ shortageBp: 700, shortageMilli: 40 });
  });
});

describe("الجرد الجزئيّ يُعلَّم", () => {
  it("toPoint يحمل علامةَ الجزئيّ كما هي", () => {
    expect(toPoint(line("a", 0, { partial: true })).partial).toBe(true);
    expect(toPoint(line("a", 0, {})).partial).toBe(false);
  });
});

describe("buildProductTrends — كلُّ صنفٍ قيس فرقُه", () => {
  it("من لم يُقَس في أيّ جرد لا يظهر، ومن ساء يتصدّر، ومن لا سعرَ لنقصه كلفتُه مجهولة", () => {
    const bad = [900, 800, 100, 150].map((_, i) => line("worse", i, { varianceConsumptionBp: [-100, -150, -900, -1100][i], varianceCostMinor: -1000 }));
    const good = [0, 1, 2, 3].map((i) => line("better", i, { varianceConsumptionBp: [-1200, -1000, -300, -100][i], varianceCostMinor: -400 }));
    const nocost = [0, 1].map((i) => line("nocost", i, { varianceCostMinor: null }));
    const never = [0, 1].map((i) => line("never", i, { varianceMilli: null, varianceConsumptionBp: null, varianceCostMinor: null }));
    const out = buildProductTrends([...good, ...nocost, ...never, ...bad]);
    expect(out.map((p) => p.productId)).toEqual(["worse", "better", "nocost"]);
    expect(out[0]).toMatchObject({ judgement: { verdict: "WORSENING" }, totalShortageCostMinor: 4000 });
    expect(out[2]).toMatchObject({ judgement: { verdict: "TOO_FEW" }, totalShortageCostMinor: null });
  });
});
