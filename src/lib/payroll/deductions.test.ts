import { describe, expect, it } from "vitest";
import { payslip } from "./calc";
import { deductionItems, deductionTotal, splitShares, type DeductionAttendance } from "./deductions";
import { monthViolations } from "./saudi-rules";

const att = (id: string, day: string, kind: DeductionAttendance["kind"], minutes: number | null, extra: Partial<DeductionAttendance> = {}): DeductionAttendance =>
  ({ id, day, kind, minutes, source: "CHECKIN", disrupted: false, penaltyWaived: false, note: null, ...extra });

describe("القسمة التراكميّة", () => {
  it("مجموعُ الحصص يساوي قيمةَ المجموع هللةً بهللة", () => {
    const value = (n: number) => Math.floor((2 * 350_000 * n + 30 * 480) / (2 * 30 * 480));
    const units = [7, 13, 1, 29, 3];
    const shares = splitShares(units, value);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(value(53));
    expect(shares.every((x) => x >= 0)).toBe(true);
  });
});

describe("خصمُ كلّ يوم", () => {
  const rate = 350_000; // ٣٥٠٠ ريال
  const policy = { shiftMinutes: 480, graceMinutes: 5 };
  const attendance = [
    att("a", "2026-10-28", "LATE", 7),
    att("b", "2026-10-29", "LATE", 4),           // في حدود السماح
    att("c", "2026-10-30", "EARLY", 13),
    att("d", "2026-11-01", "ABSENT", null),
    att("e", "2026-11-02", "LATE", 41, { penaltyWaived: true }),
    att("f", "2026-11-03", "LEAVE", null, { source: "MANUAL" }),
  ];
  const regs = monthViolations({ month: "2026-11", monthlyMinor: rate, graceMinutes: 5, daysOff: "", history: attendance, manual: [] });
  const items = deductionItems({ kind: "MONTHLY", rateMinor: rate, shiftMinutes: 480, graceMinutes: 5, attendance, violations: regs.items });
  const slip = payslip({
    kind: "MONTHLY", salaryMinor: rate, days: null, weeksMinor: [], policy, adjustments: [], attendance, penalties: regs.capped, paidMinor: 0,
  });

  it("أجرُ الوقت والأيّام يساوي ما في القسيمة بالضبط", () => {
    const wages = items.reduce((s, i) => s + (i.wageMinor ?? 0), 0);
    expect(wages).toBe((slip.lateMinor ?? 0) + (slip.absenceMinor ?? 0));
  });
  it("السماحُ والإجازةُ لا يُحسمان", () => {
    const b = items.find((i) => i.id === "b")!;
    expect(b.withinGrace).toBe(true);
    expect(b.wageMinor).toBe(0);
    expect(b.penalty).toBeNull();
    const f = items.find((i) => i.id === "f")!;
    expect(f.wageMinor).toBe(0);
  });
  it("الجزاءُ بجانب يومه، والمعفوُّ عنه صفرٌ ويبقى أجرُ وقته", () => {
    const a = items.find((i) => i.id === "a")!;
    expect(a.penalty?.code).toBeDefined();
    const e = items.find((i) => i.id === "e")!;
    expect(e.penalty?.waived).toBe(true);
    expect(e.penalty?.amountMinor).toBe(0);
    expect(e.wageMinor).toBeGreaterThan(0);
  });
  it("راتبٌ غير مكتوب: أجرُ الوقت غير معروف لا صفر", () => {
    const unknown = deductionItems({ kind: "MONTHLY", rateMinor: null, shiftMinutes: 480, graceMinutes: 5, attendance, violations: [] });
    expect(unknown.find((i) => i.id === "a")!.wageMinor).toBeNull();
    expect(deductionTotal(unknown)).toBeNull();
  });
  it("الجزئيُّ يُدفع بساعاته فلا يُحسم عليه شيء", () => {
    const part = deductionItems({ kind: "PART_TIME", rateMinor: 2_000, shiftMinutes: 480, graceMinutes: 0, attendance, violations: regs.items });
    expect(part.every((i) => i.wageMinor === 0 && i.penalty === null)).toBe(true);
  });
});
