import { describe, expect, it } from "vitest";
import { buildHeatmap, heatLevel, HEAT_LEVELS } from "./sales-heatmap";

describe("خريطة الأسبوع", () => {
  it("الخليّةُ متوسّطُ اليوم الواحد، والمقسومُ عليه أيّامُ ذلك اليوم كلُّها", () => {
    // خميسان في الشهر، وبيع في الساعة العاشرة في أحدهما فقط ٤٠٠ ريال
    const v = buildHeatmap(
      [{ weekday: 4, hour: 22, paidMinor: 40_000, orders: 10 }],
      new Map([[4, 2]]),
    );
    expect(v.rows[0].cells[0].avgMinor).toBe(20_000);
    expect(v.rows[0].cells[0].avgOrders).toBe(5);
    expect(v.peak).toEqual({ weekday: 4, hour: 22, avgMinor: 20_000 });
  });

  it("الأعمدةُ بترتيب يوم العمل: منتصفُ الليل بعد الحادية عشرة لا قبل الثامنة", () => {
    const v = buildHeatmap(
      [
        { weekday: 0, hour: 1, paidMinor: 100, orders: 1 },
        { weekday: 0, hour: 8, paidMinor: 100, orders: 1 },
        { weekday: 0, hour: 23, paidMinor: 100, orders: 1 },
      ],
      new Map([[0, 1]]),
    );
    expect(v.hours).toEqual([8, 23, 1]);
  });

  it("السبتُ أوّلُ الأسبوع، واليومُ الذي لم يُبع فيه لا صفَّ له", () => {
    const v = buildHeatmap(
      [
        { weekday: 0, hour: 9, paidMinor: 100, orders: 1 },
        { weekday: 6, hour: 9, paidMinor: 100, orders: 1 },
      ],
      new Map([[0, 1], [6, 1]]),
    );
    expect(v.rows.map((r) => r.weekday)).toEqual([6, 0]);
  });

  it("ما لم يُبع فيه صفرٌ مُعلَن لا مجهول: خليّةٌ بلا لون في ساعةٍ بيع فيها في يومٍ آخر", () => {
    const v = buildHeatmap(
      [
        { weekday: 5, hour: 22, paidMinor: 1_000, orders: 1 },
        { weekday: 6, hour: 9, paidMinor: 500, orders: 1 },
      ],
      new Map([[5, 1], [6, 1]]),
    );
    const sat = v.rows.find((r) => r.weekday === 6)!;
    expect(sat.cells.find((c) => c.hour === 22)).toMatchObject({ avgMinor: 0, level: 0 });
  });

  it("درجاتُ اللون: الأعلى أعلاها، وأصغرُ بيعٍ درجةٌ واحدة لا صفر", () => {
    expect(heatLevel(1_000, 1_000)).toBe(HEAT_LEVELS);
    expect(heatLevel(1, 1_000)).toBe(1);
    expect(heatLevel(0, 1_000)).toBe(0);
  });

  it("شهرٌ بلا مبيعات: لا ذروةَ ولا صفوف", () => {
    const v = buildHeatmap([], new Map());
    expect(v.peak).toBeNull();
    expect(v.rows).toEqual([]);
  });
});
