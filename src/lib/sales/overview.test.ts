import { describe, expect, it } from "vitest";
import {
  buildDailySeries, buildLeakSummary, buildMenuMix, changeBp, comparable, shareBp, type ItemSales, type LeakDay, type SalesDay,
} from "./overview";

const day = (d: string, salesMinor: number, orders = 10): SalesDay => ({ day: d, salesMinor, vatMinor: Math.round(salesMinor * 0.15), refundMinor: 0, orders });
const span = (from: string, n: number): string[] => {
  const [y, m, d] = from.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
};

describe("changeBp · shareBp", () => {
  it("بلا أساسٍ لا نسبة", () => {
    expect(changeBp(100, null)).toBeNull();
    expect(changeBp(100, 0)).toBeNull();
    expect(changeBp(110_00, 100_00)).toBe(1000);
    expect(changeBp(90_00, 100_00)).toBe(-1000);
    expect(shareBp(1, 0)).toBeNull();
    expect(shareBp(25, 100)).toBe(2500);
  });
});

describe("buildDailySeries", () => {
  it("اليومُ غير المستورَد null لا صفر، ويُعدّ ناقصاً", () => {
    const s = buildDailySeries([day("2026-09-01", 1000_00), day("2026-09-03", 2000_00)], "2026-09-01", "2026-09-03");
    expect(s.rows.map((r) => [r.day, r.salesMinor])).toEqual([["2026-09-03", 2000_00], ["2026-09-02", null], ["2026-09-01", 1000_00]]);
    expect(s.expectedDays).toBe(3);
    expect(s.coveredDays).toBe(2);
    expect(s.missingDays).toEqual(["2026-09-02"]);
    expect(s.salesMinor).toBe(3000_00);
  });

  it("فترةٌ بلا يومٍ مستورَد مجموعُها مجهول لا صفر", () => {
    const s = buildDailySeries([], "2026-09-01", "2026-09-07");
    expect(s.salesMinor).toBeNull();
    expect(s.orders).toBeNull();
    expect(s.coveredDays).toBe(0);
  });

  it("يومٌ مستورَد مبيعاتُه صفر صفرٌ معلوم", () => {
    const s = buildDailySeries([day("2026-09-01", 0, 0)], "2026-09-01", "2026-09-01");
    expect(s.rows[0].salesMinor).toBe(0);
    expect(s.salesMinor).toBe(0);
  });

  it("اليومُ يُقارَن بوسيط مثله من أربعة أسابيع — ودون أسبوعين مستورَدين بلا مقارنة", () => {
    const history = [day("2026-09-01", 1000_00), day("2026-09-08", 1200_00), day("2026-09-15", 800_00)];
    const s = buildDailySeries([...history, day("2026-09-22", 1500_00)], "2026-09-22", "2026-09-22");
    expect(s.rows[0].usualMinor).toBe(1000_00);
    expect(s.rows[0].vsUsualBp).toBe(5000);
    const thin = buildDailySeries([day("2026-09-15", 800_00), day("2026-09-22", 1500_00)], "2026-09-22", "2026-09-22");
    expect(thin.rows[0].usualMinor).toBeNull();
    expect(thin.rows[0].vsUsualBp).toBeNull();
  });

  it("الفترتان تُقارَنان حين تكتمل تغطيتُهما وحده", () => {
    const full = buildDailySeries(span("2026-09-01", 7).map((d) => day(d, 100)), "2026-09-01", "2026-09-07");
    const holed = buildDailySeries(span("2026-08-25", 6).map((d) => day(d, 100)), "2026-08-25", "2026-08-31");
    expect(comparable(full, full)).toBe(true);
    expect(comparable(full, holed)).toBe(false);
  });
});

describe("buildMenuMix", () => {
  const item = (key: string, salesMinor: number, quantityMilli = 1000): ItemSales => ({ key, name: key, category: null, quantityMilli, salesMinor });

  it("الترتيبُ بالمبيعات، والحصصُ تُجمع إلى الكلّ، و«يحمل ٨٠٪» يُعدّ", () => {
    const m = buildMenuMix([item("شاي", 10_00), item("لاتيه", 60_00), item("كيك", 30_00)], [], false);
    expect(m.rows.map((r) => r.key)).toEqual(["لاتيه", "كيك", "شاي"]);
    expect(m.rows.map((r) => r.shareBp)).toEqual([6000, 3000, 1000]);
    expect(m.rows.map((r) => r.cumulativeBp)).toEqual([6000, 9000, 10000]);
    expect(m.carry80).toBe(2);
    expect(m.totalMinor).toBe(100_00);
  });

  it("الاتّجاهُ وما توقّف بيعُه يُحسبان حين تُقارَن الفترتان وحده", () => {
    const now = [item("لاتيه", 60_00)];
    const before = [item("لاتيه", 50_00), item("موكا", 20_00)];
    const off = buildMenuMix(now, before, false);
    expect(off.rows[0].trendBp).toBeNull();
    expect(off.stopped).toBeNull();
    const on = buildMenuMix(now, before, true);
    expect(on.rows[0].trendBp).toBe(2000);
    expect(on.stopped?.map((i) => i.key)).toEqual(["موكا"]);
  });

  it("صنفٌ جديد لم يُبَع قبلُ اتّجاهُه بلا أساس", () => {
    const m = buildMenuMix([item("جديد", 10_00)], [], true);
    expect(m.rows[0].previousMinor).toBe(0);
    expect(m.rows[0].trendBp).toBeNull();
  });

  it("بلا مبيعاتٍ لا حصص", () => {
    const m = buildMenuMix([], [], false);
    expect(m.rows).toEqual([]);
    expect(m.carry80).toBe(0);
  });
});

describe("buildLeakSummary", () => {
  const leak = (d: string, kind: LeakDay["kind"], valueMinor: number): LeakDay => ({ day: d, kind, lines: 1, quantityMilli: 1000, valueMinor });

  it("المجاميعُ لكلّ نوعٍ ونسبتُها من المبيعات", () => {
    const s = buildLeakSummary([leak("2026-09-01", "VOID", 20_00), leak("2026-09-02", "REFUND", 30_00), leak("2026-09-02", "COMP", 50_00)], 1000_00, ["2026-09-01", "2026-09-02"]);
    expect(s.totals.map((t) => [t.kind, t.valueMinor, t.ofSalesBp])).toEqual([["VOID", 20_00, 200], ["REFUND", 30_00, 300], ["COMP", 50_00, 500]]);
    expect(s.valueMinor).toBe(100_00);
    expect(s.ofSalesBp).toBe(1000);
  });

  it("مبيعاتٌ مجهولة ⇒ نسبةٌ مجهولة", () => {
    expect(buildLeakSummary([leak("2026-09-01", "VOID", 20_00)], null, ["2026-09-01"]).ofSalesBp).toBeNull();
  });

  it("القفزةُ: يومٌ فوق ثلاثة أمثال وسيط الأيّام المستورَدة وفوق الحدّ", () => {
    const days = span("2026-09-01", 10);
    const normal = days.slice(0, 9).map((d) => leak(d, "VOID", 40_00));
    const s = buildLeakSummary([...normal, leak(days[9], "VOID", 400_00)], 10_000_00, days);
    expect(s.spikes).toEqual([{ day: days[9], valueMinor: 400_00, usualMinor: 40_00 }]);
  });

  it("دون سبعة أيّامٍ مستورَدة لا تُعرف العادة فلا قفزة", () => {
    const days = span("2026-09-01", 3);
    expect(buildLeakSummary([leak(days[2], "VOID", 900_00)], 10_000_00, days).spikes).toEqual([]);
  });

  it("يومٌ مستورَد بلا تسريبٍ صفرٌ معلوم يدخل الوسيط", () => {
    const days = span("2026-09-01", 8);
    const s = buildLeakSummary([leak(days[7], "COMP", 150_00)], 10_000_00, days);
    expect(s.spikes.map((x) => x.day)).toEqual([days[7]]);
  });
});
