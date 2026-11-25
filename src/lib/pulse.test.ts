import { describe, expect, it } from "vitest";
import { BUSINESS_HOURS, buildPulse, businessDayOf } from "./pulse";
import { addDays } from "./riyadh-time";

const base = {
  businessDay: "2026-11-25", nowHour: 14,
  today: [{ hour: 8, paidMinor: 100_00, orders: 4 }, { hour: 13, paidMinor: 300_00, orders: 10 }],
  lastWeek: [{ hour: 8, paidMinor: 50_00, orders: 2 }, { hour: 21, paidMinor: 900_00, orders: 30 }],
  lastWeekToNow: { paidMinor: 320_00, orders: 12 },
  yesterday: { paidMinor: 4_200_00, orders: 140 },
  yesterdayUsualMinor: 3_500_00,
  syncedAt: "2026-11-25T10:00:00.000Z",
};

describe("نبض المقهى", () => {
  it("يجمع اليوم حتى الآن ويقارنه بنظيره حتى الساعة نفسها لا باليوم كلّه", () => {
    const v = buildPulse(base);
    expect(v.paidMinor).toBe(400_00);
    expect(v.orders).toBe(14);
    expect(v.avgOrderMinor).toBe(2857);
    expect(v.vsLastWeekBp).toBe(2500);
    expect(v.yesterday?.vsUsualBp).toBe(2000);
  });

  it("الساعاتُ بترتيب يوم العمل، وما لم يأتِ بعد ليس صفراً", () => {
    const v = buildPulse(base);
    expect(v.hours[0].hour).toBe(8);
    expect(v.hours.at(-1)?.hour).toBe(21);
    expect(v.hours.find((h) => h.hour === 11)?.todayMinor).toBe(0);
    expect(v.hours.find((h) => h.hour === 15)?.todayMinor).toBeNull();
    expect(v.hours.find((h) => h.hour === 21)?.todayMinor).toBeNull();
    expect(v.peakMinor).toBe(900_00);
  });

  it("بلا نظيرٍ معروف لا نسبة، وما بعد منتصف الليل من يوم العمل نفسه", () => {
    expect(buildPulse({ ...base, lastWeekToNow: null }).vsLastWeekBp).toBeNull();
    expect(businessDayOf("2026-11-25", 2, addDays)).toBe("2026-11-24");
    expect(businessDayOf("2026-11-25", 9, addDays)).toBe("2026-11-25");
    expect(BUSINESS_HOURS.slice(-2)).toEqual([3, 4]);
  });

  it("«أمس» قبل الخامسة فجراً هو يومُ العمل الذي أُغلق للتوّ، وبعدها أمسُ بمعتاده", () => {
    expect(buildPulse(base).lastDay).toEqual({ paidMinor: 4_200_00, orders: 140, vsBp: 2000, against: "USUAL" });
    const late = buildPulse({ ...base, nowHour: 4 });
    expect(late.lastDay).toEqual({ paidMinor: 400_00, orders: 14, vsBp: 2500, against: "LAST_WEEK" });
  });
});
