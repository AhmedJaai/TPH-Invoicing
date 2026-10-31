import { describe, expect, it } from "vitest";
import {
  absenceCode, absenceSpells, assess, capPenalties, damageCapMinor, earlyCode, lateCode, loanCapMinor, monthViolations,
  penaltyMinor, totalCapMinor, type AttendanceRecord, type ViolationEvent,
} from "./saudi-rules";

const SALARY = 300_000;
const DAILY = 10_000;
const late = (id: string, day: string, minutes: number, extra: Partial<AttendanceRecord> = {}): AttendanceRecord =>
  ({ id, day, kind: "LATE", minutes, disrupted: false, penaltyWaived: false, ...extra });
const absent = (id: string, day: string, extra: Partial<AttendanceRecord> = {}): AttendanceRecord =>
  ({ id, day, kind: "ABSENT", minutes: null, disrupted: false, penaltyWaived: false, ...extra });
const ev = (id: string, code: string, day: string, waived = false): ViolationEvent => ({ id, code, day, waived, detail: "" });

describe("بنود الجدول بمدّة التأخير", () => {
  it("التأخير والانصراف والغياب", () => {
    expect(lateCode(10, false)).toBe("1/1");
    expect(lateCode(15, true)).toBe("1/2");
    expect(lateCode(16, false)).toBe("1/3");
    expect(lateCode(30, true)).toBe("1/4");
    expect(lateCode(45, false)).toBe("1/5");
    expect(lateCode(60, true)).toBe("1/6");
    expect(lateCode(61, false)).toBe("1/7");
    expect(earlyCode(15)).toBe("1/8");
    expect(earlyCode(16)).toBe("1/9");
    expect(absenceCode(1)).toBe("1/11");
    expect(absenceCode(5)).toBe("1/12");
    expect(absenceCode(9)).toBe("1/13");
    expect(absenceCode(11)).toBe("ART80");
  });
});

describe("المرّات والتكرار خلال ١٨٠ يوماً", () => {
  it("تأخر حتى ١٥ دقيقة: إنذار ثم ٥٪ ثم ١٠٪ ثم ٢٠٪ من أجر اليوم، والخامسة كالرابعة", () => {
    const r = assess(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"].map((d, i) => ev(`a${i}`, "1/1", d)), DAILY);
    expect(r.map((v) => v.amountMinor)).toEqual([0, 500, 1_000, 2_000, 2_000]);
    expect(r[0].penalty.kind).toBe("WARNING");
  });
  it("مضيّ أكثر من ١٨٠ يوماً يعيدها أولى", () => {
    const r = assess([ev("a", "1/3", "2026-01-01"), ev("b", "1/3", "2026-07-01")], DAILY);
    expect(r.map((v) => v.occurrence)).toEqual([1, 1]);
    const r2 = assess([ev("a", "1/3", "2026-01-01"), ev("b", "1/3", "2026-06-29")], DAILY);
    expect(r2.map((v) => v.occurrence)).toEqual([1, 2]);
  });
  it("المعفى عنها لا تُحسم ولا تُعدّ في التكرار", () => {
    const r = assess([ev("a", "1/1", "2026-01-01", true), ev("b", "1/1", "2026-01-02")], DAILY);
    expect(r.map((v) => [v.occurrence, v.amountMinor])).toEqual([[1, 0], [1, 0]]);
  });
  it("كلّ بندٍ يُعدّ وحده", () => {
    const r = assess([ev("a", "1/1", "2026-01-01"), ev("b", "1/3", "2026-01-02")], DAILY);
    expect(r.map((v) => v.occurrence)).toEqual([1, 1]);
  });
});

describe("الحدود النظامية", () => {
  it("المخالفة ≤ أجر ٥ أيام، ومجموع الشهر ≤ أجر ٥ أيام، والزائد لا يُحسم", () => {
    const r = assess([ev("a", "3/1", "2026-01-01"), ev("b", "3/1", "2026-01-02"), ev("c", "3/1", "2026-01-03")], DAILY);
    expect(r.map((v) => v.amountMinor)).toEqual([10_000, 20_000, 30_000]);
    const c = capPenalties(r, DAILY);
    expect(c.chargedMinor).toBe(50_000);
    expect(c.droppedMinor).toBe(10_000);
  });
  it("الفصل قرارٌ لا مبلغ", () => {
    const r = assess([ev("a", "1/13", "2026-01-01"), ev("b", "1/13", "2026-02-01"), ev("c", "1/13", "2026-03-01")], DAILY);
    const c = capPenalties(r, DAILY);
    expect(c.dismissals.map((d) => d.id)).toEqual(["c"]);
  });
  it("تعويض الضرر وقسط القرض ونصف الأجر", () => {
    expect(damageCapMinor(SALARY)).toBe(50_000);
    expect(loanCapMinor(SALARY)).toBe(30_000);
    expect(totalCapMinor(SALARY)).toBe(150_000);
    expect(penaltyMinor({ kind: "PCT", bp: 2_500 }, 12_250)).toBe(3_063);
  });
});

describe("الغياب نوبات، وأيام الراحة لا تقطعها", () => {
  it("الخميس ثم السبت مع راحة الجمعة نوبة واحدة", () => {
    const workday = (d: string) => d !== "2026-10-23";
    expect(absenceSpells([{ id: "a", day: "2026-10-22" }, { id: "b", day: "2026-10-24" }], workday)).toEqual([{ id: "a", start: "2026-10-22", days: 2 }]);
    expect(absenceSpells([{ id: "a", day: "2026-10-20" }, { id: "b", day: "2026-10-22" }], workday).length).toBe(2);
  });
});

describe("مخالفات الشهر من الحضور", () => {
  it("التأخير ضمن السماح لا يُعدّ، والتكرار يُعدّ من الشهور السابقة", () => {
    const r = monthViolations({
      month: "2026-10", monthlyMinor: SALARY, graceMinutes: 5, daysOff: "5",
      history: [late("s", "2026-09-10", 10), late("g", "2026-10-01", 4), late("t", "2026-10-02", 12), late("d", "2026-10-03", 20, { disrupted: true }), absent("x", "2026-10-05")],
      manual: [],
    });
    expect(r.items.map((v) => [v.code, v.occurrence, v.amountMinor])).toEqual([
      ["1/1", 2, 500],
      ["1/4", 1, 2_500],
      ["1/11", 1, 10_000],
    ]);
    expect(r.capped.chargedMinor).toBe(13_000);
  });
  it("تأخيرُ ٢٧ أكتوبر يُحسم من راتب نوفمبر لا أكتوبر — صُرف أكتوبر يومَ ٢٧ (قرار أحمد)", () => {
    const history = [late("a", "2026-10-26", 12), late("b", "2026-10-27", 12)];
    const oct = monthViolations({ month: "2026-10", monthlyMinor: SALARY, graceMinutes: 5, daysOff: "", history, manual: [] });
    const nov = monthViolations({ month: "2026-11", monthlyMinor: SALARY, graceMinutes: 5, daysOff: "", history, manual: [] });
    expect(oct.items.map((v) => v.day)).toEqual(["2026-10-26"]);
    expect(nov.items.map((v) => v.day)).toEqual(["2026-10-27"]);
  });
  it("غياب أكثر من عشرة أيام متصلة: المادة ٨٠ لا جزاء مالي", () => {
    const days = Array.from({ length: 11 }, (_, i) => absent(`a${i}`, `2026-10-${String(i + 1).padStart(2, "0")}`));
    const r = monthViolations({ month: "2026-10", monthlyMinor: SALARY, graceMinutes: 0, daysOff: "", history: days, manual: [] });
    expect(r.items).toEqual([]);
    expect(r.article80).toEqual([{ start: "2026-10-01", days: 11 }]);
  });
});
