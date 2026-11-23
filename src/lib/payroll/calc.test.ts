import { describe, expect, it } from "vitest";
import {
  endOfService, loanBalance, workedDays,
  absenceDeductionMinor, beneficiaryIdOf, beneficiaryNameOf, divRound, hoursPayMinor, parseHours,
  payrollTotals, payslip, rateFor, suggestedPayMonth, unitValues, weekMonth, weekStartOf, weeksOfMonth,
  type PayslipInput,
} from "./calc";

const policy = { shiftMinutes: 480, graceMinutes: 0 };
const base: PayslipInput = {
  kind: "MONTHLY", salaryMinor: 300_000, days: null, weeksMinor: [], policy,
  adjustments: [], attendance: [], paidMinor: 0,
};
const late = (...m: number[]) => m.map((minutes) => ({ kind: "LATE" as const, minutes }));

describe("rateFor — الراتب يتغيّر بشهرٍ يبدأ منه", () => {
  const rates = [{ fromMonth: "2026-05", amountMinor: 300_000 }, { fromMonth: "2026-09", amountMinor: 350_000 }];
  it("مايو إلى أغسطس ٣٠٠٠، ومن سبتمبر ٣٥٠٠", () => {
    expect(rateFor(rates, "2026-05")).toBe(300_000);
    expect(rateFor(rates, "2026-08")).toBe(300_000);
    expect(rateFor(rates, "2026-09")).toBe(350_000);
    expect(rateFor(rates, "2026-12")).toBe(350_000);
  });
  it("قبل أوّل راتبٍ مكتوب: غير معروف لا صفر", () => {
    expect(rateFor(rates, "2026-04")).toBeNull();
    expect(rateFor([], "2026-05")).toBeNull();
  });
});

describe("أجر الوقت غير المعمول", () => {
  it("قيم الدقيقة والساعة واليوم من راتب ٣٠٠٠ ودوام ثماني ساعات", () => {
    expect(unitValues(300_000, 480)).toEqual({ minuteMinor: 21, hourMinor: 1_250, dayMinor: 10_000 });
  });
  it("الغياب: يومٌ = الراتب ÷ ٣٠", () => {
    expect(absenceDeductionMinor(300_000, 2)).toBe(20_000);
    expect(absenceDeductionMinor(null, 1)).toBeNull();
  });
});

describe("payslip — كم لازم أحوّل", () => {
  it("راتب + مكافأة − خصم − مخالفة − تأخير − سلفة − ما حُوِّل", () => {
    const s = payslip({
      ...base,
      adjustments: [
        { kind: "BONUS", amountMinor: 20_000 },
        { kind: "DEDUCTION", amountMinor: 5_000 },
        { kind: "FINE", amountMinor: 10_000 },
        { kind: "ADVANCE", amountMinor: 50_000 },
      ],
      attendance: late(60),
      paidMinor: 100_000,
    });
    expect(s.earnedMinor).toBe(300_000 + 20_000 - 5_000 - 10_000 - 1_250);
    expect(s.dueMinor).toBe(s.earnedMinor! - 50_000);
    expect(s.remainingMinor).toBe(s.dueMinor! - 100_000);
  });
  it("راتبٌ غير مكتوب: المستحقّ والباقي غير معروفين، وما حُوِّل يبقى معروفاً", () => {
    const s = payslip({ ...base, salaryMinor: null, paidMinor: 70_000 });
    expect(s.dueMinor).toBeNull();
    expect(s.remainingMinor).toBeNull();
    expect(s.paidMinor).toBe(70_000);
  });
  it("الجزئيّ: مجموعُ أسابيعه، ولا خصمَ تأخيرٍ عليه", () => {
    const s = payslip({ ...base, kind: "PART_TIME", salaryMinor: null, weeksMinor: [40_000, 35_000], attendance: late(30), paidMinor: 40_000 });
    expect(s.baseMinor).toBe(75_000);
    expect(s.lateMinor).toBe(0);
    expect(s.remainingMinor).toBe(35_000);
  });
  it("المجموع لا يعدّ المجهول صفراً، ولا يطرح الزائد من باقي غيره", () => {
    const t = payrollTotals([
      payslip({ ...base, paidMinor: 400_000 }),
      payslip({ ...base, paidMinor: 100_000 }),
      payslip({ ...base, salaryMinor: null }),
    ]);
    expect(t).toEqual({ dueMinor: 600_000, paidMinor: 500_000, remainingMinor: 200_000, overpaidMinor: 100_000, unknown: 1 });
  });
  it("قسطُ السلفة ينقص الراتب، وسلفةُ الأقساط النقديّة لا تمسّه", () => {
    const s = payslip({ ...base, adjustments: [{ kind: "LOAN_REPAYMENT", amountMinor: 50_000 }, { kind: "LOAN_GIVEN", amountMinor: 200_000 }] });
    expect(s.dueMinor).toBe(250_000);
    expect(loanBalance({ loanLinksMinor: 100_000, loanGivenMinor: 200_000, repaidMinor: 50_000 })).toBe(250_000);
  });
  it("السماح عتبة: ما دونه لا يُحسب وما فوقه يُحسب كله، والانصراف بلا سماح، والإجازة لا تُخصم", () => {
    const s = payslip({ ...base, policy: { shiftMinutes: 480, graceMinutes: 15 }, attendance: [
      { kind: "LATE", minutes: 10 }, { kind: "LATE", minutes: 20 }, { kind: "EARLY", minutes: 60 }, { kind: "LEAVE", minutes: null }, { kind: "ABSENT", minutes: null },
    ] });
    expect(s.lateMinutes).toBe(20);
    expect(s.lateMinor).toBe(divRound(300_000 * 80, 30 * 480));
    expect(s.earlyMinutes).toBe(60);
    expect(s.leaveDays).toBe(1);
    expect(s.absenceMinor).toBe(10_000);
  });
  it("مَن باشر منتصف الشهر يأخذ أيّامه، والخصمُ على راتبه الكامل", () => {
    const days = workedDays({ hiredOn: "2026-10-15", leftOn: null }, "2026-10");
    expect(days).toEqual({ worked: 17, of: 31 });
    const s = payslip({ ...base, days, attendance: late(60) });
    expect(s.baseMinor).toBe(divRound(300_000 * 17, 31));
    expect(s.lateMinor).toBe(1_250);
    expect(workedDays({ hiredOn: "2026-05-14", leftOn: "2026-09-10" }, "2026-09")).toEqual({ worked: 10, of: 30 });
    expect(workedDays({ hiredOn: "2026-05-14", leftOn: "2026-09-10" }, "2026-10")).toBeNull();
  });
  it("مكافأة نهاية الخدمة", () => {
    expect(endOfService(300_000, 365).fullMinor).toBe(150_000);
    expect(endOfService(300_000, 365).resignationMinor).toBe(0);
    expect(endOfService(300_000, 3 * 365).resignationMinor).toBe(divRound(450_000, 3));
    expect(endOfService(300_000, 6 * 365).fullMinor).toBe(5 * 150_000 + 300_000);
  });
});

describe("الساعات والأسابيع", () => {
  it("يقرأ الساعات نصّاً", () => {
    expect(parseHours("7")).toBe(420);
    expect(parseHours("7.5")).toBe(450);
    expect(parseHours("٧٫٢٥")).toBe(435);
    expect(parseHours("7:30")).toBe(450);
    expect(parseHours("0")).toBeNull();
    expect(parseHours("abc")).toBeNull();
  });
  it("أجرُ الأسبوع من الساعات", () => {
    expect(hoursPayMinor(450, 2_000)).toBe(15_000);
  });
  it("الأسبوع من الأحد إلى السبت، ولشهر سبته", () => {
    expect(weekStartOf("2026-10-23")).toBe("2026-10-18");
    expect(weekMonth("2026-09-27")).toBe("2026-10");
    expect(weeksOfMonth("2026-10")).toEqual(["2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"]);
  });
});

describe("الحوالات", () => {
  it("رقم المستفيد واسمه من الوصف", () => {
    expect(beneficiaryIdOf(null, "الوليد محمد علي بامخشب BEN ID:1129311518")).toBe("1129311518");
    expect(beneficiaryIdOf("حوالة بلا رقم")).toBeNull();
    expect(beneficiaryNameOf("", "صالح نزار بن صالح كيكي BEN ID:1101486148")).toBe("صالح نزار بن صالح كيكي");
  });
  it("حوالةُ أوّل الشهر لراتب الشهر السابق", () => {
    expect(suggestedPayMonth("2026-09-27")).toBe("2026-09");
    expect(suggestedPayMonth("2026-07-06")).toBe("2026-06");
    expect(suggestedPayMonth("2026-01-03")).toBe("2025-12");
  });
});

describe("reclassTarget — أثر الغرض في قائمة الدخل", () => {
  it("تحويلُ المالك لراتبٍ يصير راتباً، وحوالةُ الراتب لفاتورةٍ تخرج", async () => {
    const { reclassTarget } = await import("./calc");
    expect(reclassTarget("PERSONAL", "SALARY")).toBe("SALARY");
    expect(reclassTarget("SALARY", "SALARY")).toBeNull();
    expect(reclassTarget("SALARY", "INVOICE")).toBe("EXCLUDED");
    expect(reclassTarget("SALARY", "EXPENSE")).toBe("OTHER");
    expect(reclassTarget("SALARY", "PERSONAL")).toBe("PERSONAL");
    expect(reclassTarget("PERSONAL", "PERSONAL")).toBeNull();
    expect(reclassTarget("PERSONAL", "LOAN")).toBe("SALARY");
  });
});

describe("جزاءات اللائحة وحد نصف الأجر في المسيّر", () => {
  it("الجزاء المحسوم يُطرح، وما زاد على نصف الأجر لا يُحسم", () => {
    const s = payslip({ ...base, penalties: { chargedMinor: 50_000, droppedMinor: 10_000, warnings: 1 }, adjustments: [{ kind: "DEDUCTION", amountMinor: 120_000 }] });
    expect(s.penaltiesMinor).toBe(50_000);
    expect(s.overHalfMinor).toBe(20_000);
    expect(s.deductionsMinor).toBe(150_000);
    expect(s.dueMinor).toBe(150_000);
  });
});

describe("ما دُفع خارج الكشف", () => {
  it("يُحسب مما دُفع له ولا ينقص المستحق", () => {
    const s = payslip({ ...base, adjustments: [{ kind: "PAID_OUTSIDE", amountMinor: 128_400 }], paidMinor: 100_000 });
    expect(s.dueMinor).toBe(300_000);
    expect(s.paidMinor).toBe(228_400);
    expect(s.paidOutsideMinor).toBe(128_400);
    expect(s.remainingMinor).toBe(71_600);
  });
});

describe("طولُ الدوام كما يُقرأ", () => {
  it("بالعدد الصحيح والكسر", async () => {
    const { hoursLabel } = await import("./calc");
    expect(hoursLabel(60)).toBe("ساعة واحدة");
    expect(hoursLabel(120)).toBe("ساعتان");
    expect(hoursLabel(480)).toBe("8 ساعات");
    expect(hoursLabel(720)).toBe("12 ساعة");
    expect(hoursLabel(450)).toBe("7:30 ساعة");
  });
});

describe("رصيد الإجازة السنويّة (م ١٠٩)", () => {
  it("سنةٌ كاملة = ٢١ يوماً، ونصفُها ١٠٫٥", async () => {
    const { leaveBalance, formatLeaveDays } = await import("./calc");
    expect(leaveBalance(365, 0, null).accruedMilliDays).toBe(21_000);
    expect(formatLeaveDays(leaveBalance(365 / 2 + 0.5, 0, null).accruedMilliDays)).toBe("10.5");
  });

  it("بعد خمس سنوات ٣٠ يوماً عن كلّ سنة", async () => {
    const { leaveBalance } = await import("./calc");
    const b = leaveBalance(6 * 365, 0, null);
    expect(b.accruedMilliDays).toBe(5 * 21_000 + 30_000);
    expect(b.perYear).toBe(30);
  });

  it("المأخوذُ يُطرح، والقيمةُ بأجر اليوم (الراتب ÷ ٣٠)", async () => {
    const { leaveBalance } = await import("./calc");
    const b = leaveBalance(365, 6, 3000_00);
    expect(b.balanceMilliDays).toBe(15_000);
    expect(b.valueMinor).toBe(1500_00);
  });

  it("من أخذ أكثر ممّا استحقّ رصيدُه سالب، وبلا راتبٍ قيمتُه غير معروفة", async () => {
    const { leaveBalance, formatLeaveDays } = await import("./calc");
    const b = leaveBalance(30, 5, null);
    expect(b.balanceMilliDays).toBeLessThan(0);
    expect(formatLeaveDays(b.balanceMilliDays)).toBe("−3.3");
    expect(b.valueMinor).toBeNull();
  });
});

describe("نوع الإجازة (109)", () => {
  it("بلا أجر يُخصم أجرُ يومها، والسنويّةُ والمرضيّةُ لا", () => {
    const leave = (leaveType: "ANNUAL" | "SICK" | "UNPAID") => ({ kind: "LEAVE" as const, minutes: null, leaveType });
    const s = payslip({ ...base, attendance: [leave("UNPAID"), leave("UNPAID"), leave("SICK"), leave("ANNUAL")] });
    expect(s.leaveDays).toBe(4);
    expect(s.unpaidLeaveDays).toBe(2);
    /* ٣٠٠٠ ÷ ٣٠ × ٢ = ٢٠٠ */
    expect(s.absenceMinor).toBe(20_000);
    expect(payslip({ ...base, attendance: [leave("SICK"), leave("ANNUAL")] }).absenceMinor).toBe(0);
  });

  it("الإجازةُ القديمة بلا نوع سنويّة — لا يُخصم عنها", () => {
    expect(payslip({ ...base, attendance: [{ kind: "LEAVE", minutes: null }] }).absenceMinor).toBe(0);
  });
});


describe("سطر الأيام التي لم تُعمل", () => {
  it("يسمّي الإجازة بلا أجر — كانت تُخصم ولا يظهر لها سطر", async () => {
    const { absenceLineLabel } = await import("./calc");
    expect(absenceLineLabel({ absentDays: 0, unpaidLeaveDays: 0 })).toBeNull();
    expect(absenceLineLabel({ absentDays: 0, unpaidLeaveDays: 7 })).toContain("أجر أيام الإجازة بلا أجر");
    expect(absenceLineLabel({ absentDays: 2, unpaidLeaveDays: 0 })).toContain("أجر أيام الغياب (غياب");
    expect(absenceLineLabel({ absentDays: 1, unpaidLeaveDays: 3 })).toMatch(/^أجر أيام الغياب والإجازة بلا أجر \(غياب .+، إجازة بلا أجر .+\)$/);
  });
});
