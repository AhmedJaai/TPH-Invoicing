import { describe, expect, it } from "vitest";
import {
  clock12, clockMinutes, dayForOut, daysOffLabel, distanceMeters, earlyMinutesAt, isWorkday, judgeCheckin, lateMinutesAt, riyadhClock, riyadhDay,
  shiftEndOf, shiftLength, shiftRange, toMicro, workedMinutes,
} from "./attendance";

const cafe = { latMicro: toMicro(21.6136), lngMicro: toMicro(39.1567), radiusM: 120 };

describe("الموقع والشبكة", () => {
  it("المسافة بالأمتار", () => {
    expect(distanceMeters(cafe.latMicro, cafe.lngMicro, cafe.latMicro + 1_000, cafe.lngMicro)).toBe(111);
  });
  it("داخل النطاق مع هامش الدقّة", () => {
    expect(judgeCheckin({ place: cafe, position: { latMicro: cafe.latMicro + 1_500, lngMicro: cafe.lngMicro, accuracyM: 60 }, onNetwork: false }).verdict).toBe("IN_PLACE");
  });
  it("بعيدٌ لكنّه على شبكة المقهى", () => {
    expect(judgeCheckin({ place: cafe, position: { latMicro: cafe.latMicro + 50_000, lngMicro: cafe.lngMicro, accuracyM: 20 }, onNetwork: true }).verdict).toBe("ON_NETWORK");
  });
  it("بعيدٌ بلا شبكة، وبلا موقع", () => {
    expect(judgeCheckin({ place: cafe, position: { latMicro: cafe.latMicro + 50_000, lngMicro: cafe.lngMicro, accuracyM: 5_000 }, onNetwork: false }).verdict).toBe("FAR");
    expect(judgeCheckin({ place: cafe, position: null, onNetwork: false }).verdict).toBe("NO_LOCATION");
    expect(judgeCheckin({ place: null, position: { latMicro: 1, lngMicro: 1, accuracyM: 5 }, onNetwork: false }).verdict).toBe("FAR");
  });
});

describe("الوقت بتوقيت الرياض", () => {
  const at = (iso: string) => new Date(iso);
  it("يوم الرياض وساعته", () => {
    expect(riyadhDay(at("2026-10-22T22:30:00Z"))).toBe("2026-10-23");
    expect(riyadhClock(at("2026-10-23T13:05:00Z"))).toBe("16:05");
  });
  it("التأخير عن بداية الدوام", () => {
    expect(lateMinutesAt(at("2026-10-23T13:17:00Z"), "2026-10-23", "16:00")).toBe(17);
    expect(lateMinutesAt(at("2026-10-23T12:50:00Z"), "2026-10-23", "16:00")).toBe(0);
  });
  it("الانصراف المبكّر، ودوامٌ يعبر منتصف الليل", () => {
    expect(earlyMinutesAt(at("2026-10-23T20:30:00Z"), "2026-10-23", "16:00", 480)).toBe(30);
    expect(dayForOut(at("2026-10-23T21:10:00Z"), { at: at("2026-10-23T13:00:00Z"), day: "2026-10-23" })).toBe("2026-10-23");
    expect(dayForOut(at("2026-10-25T21:10:00Z"), { at: at("2026-10-23T13:00:00Z"), day: "2026-10-23" })).toBe("2026-10-26");
  });
  it("يوم الراحة", () => {
    expect(isWorkday("2026-10-23", "5")).toBe(false);
    expect(isWorkday("2026-10-24", "5")).toBe(true);
  });
  it("ساعات الجزئي من أزواج الحضور", () => {
    const r = workedMinutes([
      { kind: "IN", at: at("2026-10-20T13:00:00Z") }, { kind: "OUT", at: at("2026-10-20T17:30:00Z") },
      { kind: "IN", at: at("2026-10-21T13:00:00Z") },
      { kind: "IN", at: at("2026-10-22T13:00:00Z"), rejected: true }, { kind: "OUT", at: at("2026-10-22T15:00:00Z"), rejected: true },
    ]);
    expect(r).toEqual({ minutes: 270, open: 1 });
  });
});

describe("الدوام من الساعة كم إلى كم", () => {
  it("الطول من البداية والنهاية — والنهاية بعد منتصف الليل تلتفّ", () => {
    expect(shiftLength("08:00", "16:00")).toBe(480);
    expect(shiftLength("16:00", "00:00")).toBe(480);
    expect(shiftLength("18:00", "02:30")).toBe(510);
  });
  it("لا يُقبل صفرٌ ولا أقلّ من ساعة ولا فوق ستّ عشرة ولا وقتٌ غير مفهوم", () => {
    expect(shiftLength("08:00", "08:00")).toBeNull();
    expect(shiftLength("08:00", "08:30")).toBeNull();
    expect(shiftLength("06:00", "23:00")).toBeNull();
    expect(shiftLength("8:00", "16:00")).toBeNull();
    expect(shiftLength("24:00", "08:00")).toBeNull();
  });
  it("النهاية من البداية والطول — ذهاباً وإياباً", () => {
    expect(shiftEndOf("16:00", 480)).toBe("00:00");
    expect(shiftEndOf("18:00", 510)).toBe("02:30");
    expect(shiftLength("18:00", shiftEndOf("18:00", 510))).toBe(510);
    expect(clockMinutes("07:45")).toBe(465);
  });
  it("الساعة كما يقرؤها الموظّف، والراحة بأسمائها", () => {
    expect(clock12("00:00")).toBe("12:00 ص");
    expect(clock12("12:30")).toBe("12:30 م");
    expect(clock12("16:05")).toBe("4:05 م");
    expect(shiftRange("16:00", 480)).toBe("4:00 م – 12:00 ص");
    expect(shiftRange(null, 480)).toBeNull();
    expect(daysOffLabel("65")).toBe("الجمعة والسبت");
    expect(daysOffLabel("")).toBeNull();
  });
});

describe("يومُ التجربة لا يُخصم منه", () => {
  it("التأخيرُ من التسجيل يبدأ ٨ نوفمبر ٢٠٢٦", async () => {
    const { checkinCounts } = await import("./attendance");
    expect(checkinCounts("2026-11-07")).toBe(false);
    expect(checkinCounts("2026-11-08")).toBe(true);
  });
});

describe("الدوامُ المخصَّص لكلّ يوم", () => {
  // 2026-11-08 الأحد · 09 الاثنين · 13 الجمعة
  const base = { shiftStart: "16:00", shiftMinutes: 480, daysOff: "5" };
  const rules = [
    { weekday: 0, day: null, shiftStart: "15:00", shiftMinutes: 480, off: false },
    { weekday: null, day: "2026-11-10", shiftStart: "15:30", shiftMinutes: 420, off: false },
    { weekday: null, day: "2026-11-11", shiftStart: null, shiftMinutes: null, off: true },
    { weekday: null, day: "2026-11-13", shiftStart: "12:00", shiftMinutes: 300, off: false },
  ];
  it("يومُ الأسبوع يغلب الأصل", async () => {
    const { shiftOn } = await import("./attendance");
    expect(shiftOn("2026-11-08", base, rules)).toEqual({ off: false, start: "15:00", minutes: 480, source: "WEEKDAY" });
    expect(shiftOn("2026-11-09", base, rules)).toEqual({ off: false, start: "16:00", minutes: 480, source: "BASE" });
  });
  it("واليومُ بعينه يغلبهما: وقتاً، أو راحةً، أو دواماً في يوم الراحة", async () => {
    const { shiftOn } = await import("./attendance");
    expect(shiftOn("2026-11-10", base, rules)).toEqual({ off: false, start: "15:30", minutes: 420, source: "DAY" });
    expect(shiftOn("2026-11-11", base, rules)).toEqual({ off: true });
    expect(shiftOn("2026-11-13", base, rules)).toEqual({ off: false, start: "12:00", minutes: 300, source: "DAY" });
    expect(shiftOn("2026-11-20", base, rules)).toEqual({ off: true });
  });
});

describe("سجلُّ أحمد يُحسب من أوّل يوم للتجربة", () => {
  it("ويبقى غيرُه من الغد", async () => {
    const { checkinCounts } = await import("./attendance");
    expect(checkinCounts("2026-11-07", "0bf0a8be-8804-47ed-b0e7-627fdbabe537")).toBe(true);
    expect(checkinCounts("2026-11-07", "someone-else")).toBe(false);
  });
});
