import { describe, expect, it } from "vitest";
import {
  absenceCode, absenceSpells, assess, capPenalties, isViolationCode, MANUAL_CODES, monthViolations, penaltyLabel,
  penaltyMinor, RULES, type AttendanceRecord, type Penalty, type ViolationEvent,
} from "./saudi-rules";

/**
 * لائحةُ تنظيم العمل — ما كانت تنجو فيه طفراتُ Stryker. الجدولُ نفسه نصٌّ نظاميّ:
 * درجةٌ تُزاح فيه جزاءٌ ماليٌّ على عاملٍ بغير ما تقوله اللائحة.
 */
const show = (p: Penalty): string =>
  p.kind === "WARNING" ? "W" : p.kind === "PCT" ? `${p.bp / 100}%` : p.kind === "DAYS" ? `${p.days}d` : p.withGratuity ? "FIRE+" : "FIRE";

describe("جدولُ المخالفات كما في اللائحة", () => {
  it("درجاتُ كلِّ بند، وأيُّها يُضاف إليه أجرُ الوقت", () => {
    const table = Object.fromEntries(Object.values(RULES).map((r) => [r.code, `${r.ladder.map(show).join(",")}${r.plusTimeWage ? " +t" : ""}`]));
    expect(table).toEqual({
      "1/1": "W,5%,10%,20% +t", "1/2": "W,15%,25%,50% +t", "1/3": "10%,15%,25%,50% +t", "1/4": "25%,50%,75%,1d +t",
      "1/5": "25%,50%,75%,1d +t", "1/6": "30%,50%,1d,2d +t", "1/7": "W,1d,2d,3d +t", "1/8": "W,10%,25%,1d +t",
      "1/9": "10%,25%,50%,1d +t", "1/11": "1d,2d,3d,4d +t", "1/12": "2d,3d,4d,FIRE+ +t", "1/13": "4d,5d,FIRE+ +t",
      "2/3": "W,10%,15%,25%", "2/4": "W,10%,25%,50%", "2/6": "10%,25%,50%,1d", "2/7": "25%,50%,1d,2d",
      "2/8": "25%,50%,1d,2d", "2/10": "2d,3d,5d,FIRE+", "2/11": "2d,3d,5d,FIRE+", "2/12": "W,10%,25%,50%",
      "2/15": "50%,1d,2d,3d", "3/1": "1d,2d,3d,5d", "3/4": "50%,1d,2d,5d", "3/8": "2d,3d,5d,FIRE+", "3/9": "W,1d,2d,5d",
    });
    for (const r of Object.values(RULES)) expect(r.label.length).toBeGreaterThan(5);
  });

  it("ما يُسجَّل بيد صاحبه ما سوى المواعيد", () => {
    expect(MANUAL_CODES).toEqual(Object.keys(RULES).filter((c) => !c.startsWith("1/")));
    expect(MANUAL_CODES).toContain("2/3");
    expect(MANUAL_CODES.some((c) => c.startsWith("1/"))).toBe(false);
    expect(isViolationCode("2/4")).toBe(true);
    expect(isViolationCode("9/9")).toBe(false);
    expect(isViolationCode("toString")).toBe(false);
    expect(isViolationCode(2)).toBe(false);
  });

  it("أسماءُ الجزاءات كما تُعرض", () => {
    expect(penaltyLabel({ kind: "WARNING" })).toBe("إنذار كتابي");
    expect(penaltyLabel({ kind: "PCT", bp: 2_500 })).toBe("25٪ من أجر يوم");
    expect(penaltyLabel({ kind: "DAYS", days: 1 })).toBe("أجر يوم");
    expect(penaltyLabel({ kind: "DAYS", days: 2 })).toBe("أجر يومين");
    expect(penaltyLabel({ kind: "DAYS", days: 3 })).toBe("أجر 3 أيام");
    expect(penaltyLabel({ kind: "DISMISSAL", withGratuity: true })).toBe("فصل مع المكافأة");
    expect(penaltyLabel({ kind: "DISMISSAL", withGratuity: false })).toBe("فصل دون مكافأة");
    expect(penaltyMinor({ kind: "DISMISSAL", withGratuity: true }, 10_000)).toBeNull();
  });
});

describe("بندُ الغياب بطول نوبته — حدودُه", () => {
  it("٣ ← ١/١١ · ٤ ← ١/١٢ · ٦ ← ١/١٢ · ٧ ← ١/١٣ · ١٠ ← ١/١٣ · ١١ ← المادّة ٨٠", () => {
    expect(absenceCode(3)).toBe("1/11");
    expect(absenceCode(4)).toBe("1/12");
    expect(absenceCode(6)).toBe("1/12");
    expect(absenceCode(7)).toBe("1/13");
    expect(absenceCode(10)).toBe("1/13");
    expect(absenceCode(11)).toBe("ART80");
  });
});

describe("عدُّ المرّات", () => {
  const ev = (id: string, day: string, over: Partial<ViolationEvent> = {}): ViolationEvent => ({ id, code: "2/3", day, waived: false, detail: "", ...over });

  it("بعد ١٨٠ يوماً بالضبط تبقى ثانية، وبعدها بيومٍ تعود أولى", () => {
    const at180 = assess([ev("a", "2026-01-01"), ev("b", "2026-06-30")], 10_000);
    expect(at180.map((v) => v.occurrence)).toEqual([1, 2]);
    const at181 = assess([ev("a", "2026-01-01"), ev("b", "2026-07-01")], 10_000);
    expect(at181.map((v) => v.occurrence)).toEqual([1, 1]);
  });

  it("تُرتَّب بيومها لا بترتيب الإدخال — والأسبقُ هي الأولى", () => {
    const out = assess([ev("late", "2026-03-05"), ev("early", "2026-03-01")], 10_000);
    expect(out.map((v) => [v.id, v.occurrence])).toEqual([["early", 1], ["late", 2]]);
  });

  it("بندٌ مجهول يُتجاهل لا يُسقط الحساب", () => {
    expect(assess([ev("x", "2026-03-01", { code: "9/9" })], 10_000)).toEqual([]);
  });
});

describe("حدُّ الغرامات", () => {
  it("المعفى عنها لا تُحسم ولا تُعدّ، والإنذارُ يُعدّ ولا يُحسم", () => {
    const items = assess([
      { id: "w", code: "2/3", day: "2026-10-01", waived: false, detail: "" },
      { id: "x", code: "3/1", day: "2026-10-02", waived: true, detail: "" },
    ], 10_000);
    const c = capPenalties(items, 10_000);
    expect(c).toEqual({ chargedMinor: 0, droppedMinor: 0, warnings: 1, dismissals: [] });
  });
});

describe("نوباتُ الغياب", () => {
  const all = () => true;
  it("أيّامٌ غير مرتّبة تُرتَّب، والمتتالية نوبةٌ واحدة تُنسب إلى أوّلها", () => {
    const spells = absenceSpells([{ id: "c", day: "2026-10-07" }, { id: "a", day: "2026-10-05" }, { id: "b", day: "2026-10-06" }, { id: "z", day: "2026-10-20" }], all);
    expect(spells).toEqual([{ id: "a", start: "2026-10-05", days: 3 }, { id: "z", start: "2026-10-20", days: 1 }]);
  });

  it("اليومُ نفسُه مرّتين لا يطيل النوبة، وفجوةُ تسعة أيّام تقطعها ولو كانت راحة", () => {
    expect(absenceSpells([{ id: "a", day: "2026-10-05" }, { id: "b", day: "2026-10-05" }], all)).toHaveLength(2);
    const restAll = () => false;
    expect(absenceSpells([{ id: "a", day: "2026-10-01" }, { id: "b", day: "2026-10-10" }], restAll)).toHaveLength(2);
    expect(absenceSpells([{ id: "a", day: "2026-10-01" }, { id: "b", day: "2026-10-09" }], restAll)).toHaveLength(1);
  });
});

describe("مخالفاتُ الشهر من الحضور", () => {
  const rec = (id: string, day: string, over: Partial<AttendanceRecord>): AttendanceRecord => ({
    id, day, kind: "LATE", minutes: 20, disrupted: false, penaltyWaived: false, ...over,
  });
  const run = (history: AttendanceRecord[], manual: Parameters<typeof monthViolations>[0]["manual"] = [], graceMinutes = 10) =>
    monthViolations({ month: "2026-10", monthlyMinor: 300_000, graceMinutes, daysOff: "", history, manual });

  it("التأخيرُ بقدر السماح لا يُعدّ، وفوقه يُعدّ ببنده", () => {
    expect(run([rec("a", "2026-10-01", { minutes: 10 })]).items).toEqual([]);
    const r = run([rec("a", "2026-10-01", { minutes: 11 })]);
    expect(r.items.map((v) => [v.code, v.detail])).toEqual([["1/1", "تأخر 11 دقيقة"]]);
  });

  it("الانصرافُ المبكّر بنده بطوله، والإجازةُ لا شيء", () => {
    const r = run([
      rec("e1", "2026-10-01", { kind: "EARLY", minutes: 10 }),
      rec("e2", "2026-10-02", { kind: "EARLY", minutes: 20 }),
      rec("p", "2026-10-03", { kind: "LEAVE", minutes: null }),
      rec("n", "2026-10-04", { kind: "EARLY", minutes: null }),
    ]);
    expect(r.items.map((v) => [v.code, v.detail])).toEqual([
      ["1/8", "انصرف قبل الموعد بـ10 دقيقة"], ["1/9", "انصرف قبل الموعد بـ20 دقيقة"],
    ]);
  });

  it("نوبةُ الغياب بوصفها، والمعفى عنها تبقى معفاة", () => {
    const one = run([rec("a", "2026-10-05", { kind: "ABSENT", minutes: null, penaltyWaived: true })]);
    expect(one.items[0]).toMatchObject({ code: "1/11", detail: "غاب يوماً", waived: true, amountMinor: 0 });
    const two = run([rec("a", "2026-10-05", { kind: "ABSENT", minutes: null }), rec("b", "2026-10-06", { kind: "ABSENT", minutes: null })]);
    expect(two.items[0]).toMatchObject({ detail: "غاب يومين متتاليين", waived: false });
    const three = run(["05", "06", "07"].map((d, i) => rec(`a${i}`, `2026-10-${d}`, { kind: "ABSENT", minutes: null })));
    expect(three.items[0].detail).toBe("غاب 3 أيام متتالية");
  });

  it("أحدَ عشرَ يوماً: المادّة ٨٠ لا جزاء — وإن بدأت في شهرٍ آخر لا تُذكر هنا", () => {
    const days = Array.from({ length: 11 }, (_, i) => rec(`a${i}`, `2026-10-${String(i + 1).padStart(2, "0")}`, { kind: "ABSENT", minutes: null }));
    const r = run(days);
    expect(r.items).toEqual([]);
    expect(r.article80).toEqual([{ start: "2026-10-01", days: 11 }]);
    const sept = Array.from({ length: 11 }, (_, i) => rec(`s${i}`, `2026-09-${String(i + 15).padStart(2, "0")}`, { kind: "ABSENT", minutes: null }));
    expect(run(sept).article80).toEqual([]);
  });

  it("المسجَّلُ بيده بملاحظته أو باسم بنده", () => {
    const r = run([], [
      { id: "m1", day: "2026-10-02", code: "2/4", waived: false, note: "نام في المخزن" },
      { id: "m2", day: "2026-10-03", code: "2/6", waived: false, note: null },
    ]);
    expect(r.items.map((v) => v.detail)).toEqual(["نام في المخزن", RULES["2/6"].label]);
  });
});
