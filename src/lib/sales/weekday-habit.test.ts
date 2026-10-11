import { describe, expect, it } from "vitest";
import { buildWeekdayHabit, medianInt, unitsText, weekdayOf, type DaySale } from "./weekday-habit";

/* 2026-09-27 أحد — آخرُ أسبوعٍ اكتمل قبل 2026-10-04 */
const LAST = "2026-09-27";
const add = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** أسبوعٌ كامل: لاتيه كلَّ يوم بكمّيّةٍ تُعطى للخميس، و٢٠ لغيره. */
function week(start: string, thursdayCups: number, skip: number[] = []): DaySale[] {
  return Array.from({ length: 7 }, (_, i) => i).filter((i) => !skip.includes(i)).map((i) => ({
    day: add(start, i), itemId: "latte", itemName: "لاتيه", quantityMilli: (i === 4 ? thursdayCups : 20) * 1000,
  }));
}
const weeks = (n: number, cups: (i: number) => number) => Array.from({ length: n }, (_, i) => week(add(LAST, -7 * i), cups(i))).flat();

describe("عادةُ يوم الأسبوع", () => {
  it("الأحدُ صفر والسبتُ ستّة", () => {
    expect(weekdayOf("2026-09-27")).toBe(0);
    expect(weekdayOf("2026-10-03")).toBe(6);
  });

  it("الوسيطُ عددٌ صحيح، والزوجيُّ وسطُ الأوسطين", () => {
    expect(medianInt([3, 1, 2])).toBe(2);
    expect(medianInt([1, 2, 3, 4])).toBe(3);
    expect(medianInt([])).toBeNull();
  });

  it("ثمانيةُ أسابيع كاملة: وسيطُ الخميس وأدناه وأعلاه", () => {
    const h = buildWeekdayHabit(weeks(8, (i) => 35 + i * 2), LAST);
    expect(h.ready).toBe(true);
    expect(h.usableWeeks).toHaveLength(8);
    const thu = h.items[0].byWeekday[4];
    expect(thu).toEqual({ medianMilli: 42_000, minMilli: 35_000, maxMilli: 49_000, samples: 8 });
    expect(h.items[0].byWeekday[0].medianMilli).toBe(20_000);
  });

  it("دون ستّة أسابيع صالحة تُحجب كلُّها", () => {
    const h = buildWeekdayHabit(weeks(5, () => 40), LAST);
    expect(h.ready).toBe(false);
    expect(h.items).toEqual([]);
    expect(h.usableWeeks).toHaveLength(5);
    expect(h.droppedWeeks).toHaveLength(3);
  });

  it("أسبوعٌ فيه يومان بلا مبيعات يُسقَط، ويومُ إغلاقٍ واحد لا يُسقطه", () => {
    const sales = [
      ...weeks(6, () => 40),
      ...week(add(LAST, -42), 99, [0, 1]),
      ...week(add(LAST, -49), 60, [5]),
    ];
    const h = buildWeekdayHabit(sales, LAST);
    expect(h.droppedWeeks).toEqual([add(LAST, -42)]);
    expect(h.usableWeeks).toHaveLength(7);
    expect(h.items[0].byWeekday[4].maxMilli).toBe(60_000);
    /* الجمعةُ المغلقة في أسبوعٍ واحد: ستّةُ أيّامٍ لا سبعة — غيرُ معروف لا صفر */
    expect(h.items[0].byWeekday[5].samples).toBe(6);
    expect(h.items[0].byWeekday[5].minMilli).toBe(20_000);
  });

  it("يومٌ بيع فيه غيرُ هذا الصنف: صفرُه حقيقيّ يدخل الوسيط", () => {
    const sales = [
      ...weeks(8, () => 40),
      { day: LAST, itemId: "cake", itemName: "كيك", quantityMilli: 4_000 },
    ];
    const cake = buildWeekdayHabit(sales, LAST).items.find((i) => i.itemId === "cake");
    expect(cake?.byWeekday[0]).toEqual({ medianMilli: 0, minMilli: 0, maxMilli: 4_000, samples: 8 });
    expect(cake?.totalMilli).toBe(4_000);
  });

  it("ما بعد آخر أسبوعٍ اكتمل لا يدخل", () => {
    const h = buildWeekdayHabit([...weeks(8, () => 40), { day: add(LAST, 8), itemId: "latte", itemName: "لاتيه", quantityMilli: 900_000 }], LAST);
    expect(h.items[0].byWeekday[1].maxMilli).toBe(20_000);
  });

  it("الكمّيّةُ تُكتب عدداً صحيحاً أو بخانةٍ واحدة", () => {
    expect(unitsText(42_000)).toBe("42");
    expect(unitsText(41_500)).toBe("41.5");
    expect(unitsText(0)).toBe("0");
  });
});
