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

describe("الانصرافُ بعد منتصف الليل لدوامٍ يعبره", () => {
  // دوامُ السبت ١٥:٣٠ ← ٠٠:٣٠ الأحد. والأحدُ ١٦:٠٠ ← ٠٠:٠٠.
  const shiftFor = (day: string) => (day === "2026-11-07"
    ? { off: false as const, start: "15:30", minutes: 540, source: "BASE" as const }
    : { off: false as const, start: "16:00", minutes: 480, source: "BASE" as const });
  const at = (iso: string) => new Date(iso);
  it("بلا حضورٍ يقابله: ١٢:٣٠ صباحَ الأحد لدوام السبت", async () => {
    const { dayForOut } = await import("./attendance");
    expect(dayForOut(at("2026-11-07T21:30:00Z"), null, shiftFor)).toBe("2026-11-07");
  });
  it("وبعد أربع ساعاتٍ من نهايته فهو للأحد", async () => {
    const { dayForOut } = await import("./attendance");
    expect(dayForOut(at("2026-11-08T07:00:00Z"), null, shiftFor)).toBe("2026-11-08");
  });
  it("ودوامُ أمسٍ لا يعبر منتصف الليل لا يأخذ انصرافَ الصباح", async () => {
    const { dayForOut } = await import("./attendance");
    const dayShift = () => ({ off: false as const, start: "08:00", minutes: 480, source: "BASE" as const });
    expect(dayForOut(at("2026-11-07T21:30:00Z"), null, dayShift)).toBe("2026-11-08");
  });
});

describe("الدوامُ يتغيّر من تاريخ (106)", () => {
  // 2026-11-22 الأحد · 2026-12-01 الثلاثاء · 2026-12-04 الجمعة · 2026-12-05 السبت
  const plans = [
    { fromDay: "2026-05-01", shiftStart: "16:00", shiftMinutes: 480, daysOff: "5", week: [] },
    { fromDay: "2026-12-01", shiftStart: "08:00", shiftMinutes: 540, daysOff: "6", week: [{ weekday: 2, shiftStart: "10:00", shiftMinutes: 480 }] },
  ];
  /* صفُّ الموظّف يُساير اليوم — ولا يُحكم به ما دام سطرٌ يغطّي اليوم */
  const base = { shiftStart: "09:00", shiftMinutes: 480, daysOff: "", plans };
  it("ما قبل التاريخ بدوامه القديم، وما بعده بالجديد", async () => {
    const { shiftOn } = await import("./attendance");
    expect(shiftOn("2026-11-22", base, [])).toEqual({ off: false, start: "16:00", minutes: 480, source: "BASE" });
    expect(shiftOn("2026-12-03", base, [])).toEqual({ off: false, start: "08:00", minutes: 540, source: "BASE" });
  });
  it("وأيّامُ الراحة وأيّامُ الأسبوع من سطر اليوم لا من الصفّ", async () => {
    const { shiftOn } = await import("./attendance");
    expect(shiftOn("2026-11-27", base, [])).toEqual({ off: true }); // جمعة: راحتُه القديمة
    expect(shiftOn("2026-12-04", base, [])).toEqual({ off: false, start: "08:00", minutes: 540, source: "BASE" }); // جمعة: صارت دواماً
    expect(shiftOn("2026-12-05", base, [])).toEqual({ off: true }); // سبت: راحتُه الجديدة
    expect(shiftOn("2026-12-01", base, [])).toEqual({ off: false, start: "10:00", minutes: 480, source: "WEEKDAY" });
    /* وأيّامُ الأسبوع في الجدول القديم لا تتسرّب إلى سطرٍ بلاها */
    expect(shiftOn("2026-11-24", base, [{ weekday: 2, day: null, shiftStart: "12:00", shiftMinutes: 300, off: false }])).toEqual({ off: false, start: "16:00", minutes: 480, source: "BASE" });
  });
  it("واليومُ بعينه يغلب سطرَ التاريخ", async () => {
    const { shiftOn } = await import("./attendance");
    expect(shiftOn("2026-12-03", base, [{ weekday: null, day: "2026-12-03", shiftStart: null, shiftMinutes: null, off: true }])).toEqual({ off: true });
  });
  it("بلا سطورٍ يبقى الحكمُ بالصفّ كما كان", async () => {
    const { shiftOn } = await import("./attendance");
    expect(shiftOn("2026-12-03", { ...base, plans: [] }, [])).toEqual({ off: false, start: "09:00", minutes: 480, source: "BASE" });
  });
  it("النافذُ والقادم", async () => {
    const { planOn, nextPlan, planSummary } = await import("./attendance");
    expect(planOn("2026-11-30", plans)?.fromDay).toBe("2026-05-01");
    expect(planOn("2026-12-01", plans)?.fromDay).toBe("2026-12-01");
    expect(planOn("2026-04-30", plans)).toBeNull();
    expect(nextPlan("2026-11-21", plans)?.fromDay).toBe("2026-12-01");
    expect(nextPlan("2026-12-01", plans)).toBeNull();
    expect(planSummary(plans[1])).toBe("8:00 ص – 5:00 م · وبوقت مخصّص الثلاثاء 10:00 ص – 6:00 م · راحته السبت");
  });
});
