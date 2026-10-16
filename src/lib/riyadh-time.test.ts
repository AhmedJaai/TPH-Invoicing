import { timeAgo } from "./arabic";
import { describe, expect, it } from "vitest";
import {
  currentMonthRiyadh, dayOfMonthRiyadh, daysSinceRiyadh, formatDay, formatMoment, formatMonth, formatRange, formatWeekday, todayInRiyadh,
} from "./riyadh-time";

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

describe("التاريخ كما يقرأ", () => {
  it("اليوم بالاسم لا بصيغة ISO", () => {
    const day = formatDay(new Date("2026-09-14T09:00:00Z"));
    expect(day).toContain("2026");
    expect(day).not.toContain("-");
  });

  it("الإقفال بعد منتصف الليل يبقى في يومه بالرياض", () => {
    // 2026-08-31T22:30:00Z هي الواحدة والنصف فجراً من أوّل سبتمبر بالرياض
    const at = new Date("2026-08-31T22:30:00Z");
    expect(formatDay(at)).toBe(formatDay(new Date("2026-09-01T09:00:00Z")));
    expect(formatDay(at)).not.toBe(formatDay(new Date("2026-08-31T09:00:00Z")));
  });

  it("سلسلة اليوم لا تزاح يوماً", () => {
    expect(formatDay("2026-09-14")).toBe(formatDay(new Date("2026-09-14T09:00:00Z")));
  });

  it("المجهول شرطة لا تاريخ مخترع", () => {
    expect(formatDay(null)).toBe("—");
    expect(formatDay(undefined)).toBe("—");
    expect(formatDay("")).toBe("—");
  });

  it("الشهر باسمه", () => {
    expect(formatMonth("2026-08")).toContain("2026");
    expect(formatMonth("2026-08")).not.toBe("2026-08");
    // ما ليس شهراً يبقى كما هو ولا يُخترع له اسم
    expect(formatMonth("غير معروف")).toBe("غير معروف");
  });

  it("النطاق «من … إلى …» لا سهم", () => {
    const r = formatRange("2026-05-01", "2026-05-31");
    expect(r.startsWith("من ")).toBe(true);
    expect(r).toContain(" إلى ");
    expect(r).not.toContain("←");
    expect(r).not.toContain("→");
  });
});

describe("daysSinceRiyadh", () => {
  it("يعدّ بيوم الرياض لا بيوم غرينتش", () => {
    // ٢٣:٣٠ بغرينتش في ٢٣ سبتمبر = ٠٢:٣٠ في ٢٤ سبتمبر بالرياض
    expect(daysSinceRiyadh("2026-09-03", new Date("2026-09-23T23:30:00Z"))).toBe(21);
    expect(daysSinceRiyadh("2026-09-24", new Date("2026-09-24T09:00:00Z"))).toBe(0);
  });
});

describe("formatWeekday", () => {
  it("اسم اليوم ورقمه بتوقيت الرياض", () => {
    expect(formatWeekday("2026-09-27")).toBe("الأحد 27");
  });
});

describe("formatMoment", () => {
  const now = new Date("2026-09-26T09:00:00Z"); // 12:00 م بتوقيت الرياض
  it("اليوم وأمس باسمهما، والساعة بتوقيت الرياض", () => {
    expect(formatMoment(new Date("2026-09-26T00:12:00Z"), now)).toBe("اليوم 3:12 ص");
    expect(formatMoment(new Date("2026-09-25T13:05:00Z"), now)).toBe("أمس 4:05 م");
  });
  it("ما قبل أمس باسم يومه وتاريخه", () => {
    expect(formatMoment(new Date("2026-09-23T06:30:00Z"), now)).toBe("الأربعاء، 23 سبتمبر · 9:30 ص");
  });
  it("منتصف الليل بتوقيت الرياض يفصل اليوم عن أمس — لا توقيت غرينتش", () => {
    // 21:30 غرينتش يوم ٢٥ = 00:30 الرياض يوم ٢٦
    expect(formatMoment(new Date("2026-09-25T21:30:00Z"), now)).toBe("اليوم 12:30 ص");
  });
});

describe("timeAgo — «أمس» يوم التقويم بتوقيت الرياض", () => {
  const now = new Date("2026-09-26T00:52:00Z"); // السبت 3:52 ص بتوقيت الرياض
  it("ما قبل يومين تقويميّين لا يقال «أمس» ولو كان دون ٤٨ ساعة", () => {
    expect(timeAgo(new Date("2026-09-24T03:25:00Z"), now)).toBe("قبل يومين");
  });
  it("أمس التقويم «أمس»", () => {
    expect(timeAgo(new Date("2026-09-25T08:00:00Z"), now)).toBe("أمس");
  });
  it("ساعات قليلة عبر منتصف الليل تبقى بساعاتها", () => {
    expect(timeAgo(new Date("2026-09-25T20:52:00Z"), now)).toBe("قبل 4 ساعات");
  });
  it("الدقائق دقائق", () => {
    expect(timeAgo(new Date("2026-09-26T00:40:00Z"), now)).toBe("قبل 12 دقيقة");
  });
});

import { dateShortcuts, formatHijri } from "./riyadh-time";

describe("اختصارات حقل التاريخ", () => {
  it("اليوم وأمس وآخر الشهر الماضي", () => {
    expect(dateShortcuts("2026-10-09").map((c) => c.value)).toEqual(["2026-10-09", "2026-10-08", "2026-09-30"]);
  });
  it("أوّل الشهر: أمس هو آخر الشهر الماضي", () => {
    expect(dateShortcuts("2026-03-01").map((c) => c.value)).toEqual(["2026-03-01", "2026-02-28", "2026-02-28"]);
  });
  it("أوّل السنة يعبر إلى ديسمبر", () => {
    expect(dateShortcuts("2027-01-01")[2].value).toBe("2026-12-31");
  });
});

describe("المقابل الهجريّ للعرض", () => {
  it("يكتب بتقويم أمّ القرى", () => {
    const h = formatHijri("2026-10-09");
    expect(h).toMatch(/144[78]/);
  });
  it("ما لا يفهم لا يخترع له تاريخ", () => {
    expect(formatHijri("")).toBeNull();
    expect(formatHijri("2026-13-45x")).toBeNull();
    expect(formatHijri(null)).toBeNull();
  });
});

import { MS_PER_DAY, addDays, dayNumber, daysBetween, daysInMonth, isoDay, monthEndDay } from "./riyadh-time";

/*
 * المالكُ الواحد يعطي ما كانت تعطيه النسخُ المحلّيّة — حرفاً بحرف.
 *
 * كلُّ صيغةٍ قديمة منسوخةٌ هنا كما كانت في موضعها، وتُقابَل على كلّ يومٍ من
 * ٢٠٢٤ (كبيسة) إلى ٢٠٢٨ (كبيسة). فلا رقمَ على شاشةٍ تغيّر بالتوحيد.
 */
describe("حساب الأيّام والأشهر: المالك الواحد يطابق ما حلّ محلّه", () => {
  const days: string[] = [];
  for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2028, 11, 31); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const shifts = [-400, -31, -7, -1, 0, 1, 3, 7, 30, 45, 366];

  /* كما كانت في payment-echo · hand-payment-link · expense.service */
  const oldParseNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  /* كما كانت في recurring-detect · obligations */
  const oldUtcNumber = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  };
  /* كما كانت في inventory/week · signal-decisions · inventory.service · cash-outlook */
  const oldShift = (day: string, n: number) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  /* كما كانت في صفحة كشف المورّد */
  const oldNoonShift = (day: string, n: number) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it("رقم اليوم بالصيغتين القديمتين", () => {
    for (const d of days) {
      expect(dayNumber(d)).toBe(oldParseNumber(d));
      expect(dayNumber(d)).toBe(oldUtcNumber(d));
    }
  });

  it("فرق الأيّام كما في cash-runway و supplier-edit و inventory/receipts و bank/coverage", () => {
    for (let i = 0; i < days.length; i += 13) {
      for (const n of shifts) {
        const a = days[i];
        const b = oldShift(a, n);
        const oldRunway = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
        const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
        const oldApart = Math.abs(t(a) - t(b)) / 86_400_000;
        expect(daysBetween(a, b)).toBe(oldRunway);
        expect(daysBetween(a, b)).toBe(n);
        expect(Math.abs(daysBetween(a, b))).toBe(oldApart);
      }
    }
  });

  it("إزاحة الأيّام بالصيغتين القديمتين", () => {
    for (let i = 0; i < days.length; i += 3) {
      for (const n of shifts) {
        expect(addDays(days[i], n)).toBe(oldShift(days[i], n));
        expect(addDays(days[i], n)).toBe(oldNoonShift(days[i], n));
      }
    }
  });

  it("طول الشهر وآخر يومه", () => {
    for (const month of months) {
      const [y, m] = month.split("-").map(Number);
      expect(daysInMonth(month)).toBe(new Date(Date.UTC(y, m, 0)).getUTCDate());
      expect(monthEndDay(month)).toBe(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
      expect(monthEndDay(month)).toBe(`${month}-${String(daysInMonth(month)).padStart(2, "0")}`);
    }
    expect(monthEndDay("2024-02")).toBe("2024-02-29");
    expect(monthEndDay("2026-02")).toBe("2026-02-28");
    expect(monthEndDay("2026-12")).toBe("2026-12-31");
  });

  it("يوم التاريخ المخزّن هو يوم UTC لا يوم الرياض", () => {
    expect(isoDay(new Date("2026-09-30T00:00:00Z"))).toBe("2026-09-30");
    /* ٢٢:٣٠ UTC هي ١:٣٠ فجرَ الغد في الرياض — والمخزَّن يبقى على يومه */
    expect(isoDay(new Date("2026-09-30T22:30:00Z"))).toBe("2026-09-30");
    expect(MS_PER_DAY).toBe(24 * 60 * 60 * 1000);
  });

  it("ما لا يقرأ لا يصير رقماً", () => {
    expect(Number.isNaN(dayNumber("غير تاريخ"))).toBe(true);
    expect(Number.isNaN(dayNumber(""))).toBe(true);
  });
});
