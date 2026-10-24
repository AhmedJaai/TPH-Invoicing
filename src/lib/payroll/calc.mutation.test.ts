import { describe, expect, it } from "vitest";
import {
  activeIn, beneficiaryIdOf, beneficiaryNameOf, divRound, endOfService, formatMinutes, isAdjustmentKind, isPurpose,
  parseHours, payrollTotals, payslip, proratedSalary, rateFor, reclassTarget, suggestedPayMonth, weeksOfMonth,
  workedDays, type PayslipInput,
} from "./calc";

/**
 * المسيّر — ما كانت تنجو فيه طفراتُ Stryker. وكلٌّ منها راتبٌ يُحسب خطأً:
 * مجهولٌ يصير صفراً، أو حدٌّ نظاميّ يُزاح يوماً، أو حسمٌ يُضاف حيث يُطرح.
 */
const policy = { shiftMinutes: 480, graceMinutes: 10 };
const base: PayslipInput = {
  kind: "MONTHLY", salaryMinor: 300_000, days: null, weeksMinor: [], policy,
  adjustments: [], attendance: [], paidMinor: 0,
};

describe("الراتبُ المجهول لا يصير صفراً", () => {
  it("تأخيرٌ على راتبٍ لم يُكتب: أجرُ الدقائق مجهول، فالخصومُ والمستحقّ والباقي مجهولة", () => {
    const s = payslip({ ...base, salaryMinor: null, attendance: [{ kind: "LATE", minutes: 30 }] });
    expect(s.lateMinor).toBeNull();
    expect(s.deductionsMinor).toBeNull();
    expect(s.earnedMinor).toBeNull();
    expect(s.dueMinor).toBeNull();
    expect(s.remainingMinor).toBeNull();
  });

  it("وغيابٌ على راتبٍ لم يُكتب كذلك", () => {
    const s = payslip({ ...base, salaryMinor: null, attendance: [{ kind: "ABSENT", minutes: null }] });
    expect(s.absenceMinor).toBeNull();
    expect(s.deductionsMinor).toBeNull();
  });

  it("وبلا تأخيرٍ ولا غياب: الخصومُ صفرٌ معروف، والأساسُ وحده المجهول", () => {
    const s = payslip({ ...base, salaryMinor: null });
    expect(s.deductionsMinor).toBe(0);
    expect(s.baseMinor).toBeNull();
    expect(s.earnedMinor).toBeNull();
  });

  it("المجموعُ يعدّ المجهولَ ولا يجمعه صفراً — ولو عُرف أحدُ طرفيه", () => {
    const known = payslip({ ...base, paidMinor: 100_000 });
    const unknown = payslip({ ...base, salaryMinor: null, paidMinor: 50_000 });
    const t = payrollTotals([known, unknown]);
    expect(t).toEqual({ dueMinor: 300_000, paidMinor: 150_000, remainingMinor: 200_000, overpaidMinor: 0, unknown: 1 });
    /* المسدَّدُ تماماً لا يُعدّ زيادةً ولا باقياً */
    const exact = payslip({ ...base, paidMinor: 300_000 });
    expect(payrollTotals([exact])).toMatchObject({ remainingMinor: 0, overpaidMinor: 0 });
    expect(payrollTotals([{ ...known, remainingMinor: null }]).unknown).toBe(1);
  });
});

describe("أجرُ الوقت غير المعمول", () => {
  it("التأخيرُ بقدر السماح بالضبط لا يُحسب، وفوقه بدقيقةٍ يُحسب كلُّه", () => {
    expect(payslip({ ...base, attendance: [{ kind: "LATE", minutes: 10 }] }).lateMinutes).toBe(0);
    expect(payslip({ ...base, attendance: [{ kind: "LATE", minutes: 11 }] }).lateMinutes).toBe(11);
  });

  it("الانصرافُ المبكّر يُضاف إلى التأخير في الأجر لا يُطرح منه", () => {
    /* ٣٠٠٠ ريال ÷ (٣٠ × ٤٨٠ دقيقة) × (٦٠ + ٣٠) دقيقة = ١٨٫٧٥ ريال */
    const s = payslip({ ...base, attendance: [{ kind: "LATE", minutes: 60 }, { kind: "EARLY", minutes: 30 }] });
    expect(s.lateMinor).toBe(1_875);
    /* والانصرافُ وحده يُحسب كذلك */
    expect(payslip({ ...base, attendance: [{ kind: "EARLY", minutes: 48 }] }).lateMinor).toBe(1_000);
  });

  it("الخصومُ: الحسمُ + أجرُ الوقت + أجرُ الغياب — كلُّها تُضاف", () => {
    const s = payslip({
      ...base,
      adjustments: [{ kind: "FINE", amountMinor: 5_000 }],
      attendance: [{ kind: "EARLY", minutes: 48 }, { kind: "ABSENT", minutes: null }],
    });
    /* ٥٠ + ١٠ + ١٠٠ */
    expect(s.deductionsMinor).toBe(5_000 + 1_000 + 10_000);
    expect(s.earnedMinor).toBe(300_000 - 16_000);
  });

  it("الجزئيُّ لا يُحسم عليه تأخيرٌ ولا غياب — يُدفع بساعاته", () => {
    const s = payslip({ ...base, kind: "PART_TIME", weeksMinor: [40_000, 50_000], attendance: [{ kind: "LATE", minutes: 90 }, { kind: "ABSENT", minutes: null }] });
    expect(s.lateMinor).toBe(0);
    expect(s.absenceMinor).toBe(0);
    expect(s.baseMinor).toBe(90_000);
  });
});

describe("نصفُ الأجر (م ٩٢)", () => {
  it("حسمٌ يساوي النصفَ بالضبط يُحسم كلُّه، وما زاد عليه بهللةٍ لا يُحسم", () => {
    expect(payslip({ ...base, adjustments: [{ kind: "DEDUCTION", amountMinor: 150_000 }] }).overHalfMinor).toBe(0);
    const over = payslip({ ...base, adjustments: [{ kind: "DEDUCTION", amountMinor: 150_001 }] });
    expect(over.overHalfMinor).toBe(1);
    expect(over.deductionsMinor).toBe(150_000);
  });

  it("وبلا راتبٍ معروف لا حدَّ يُحسب", () => {
    expect(payslip({ ...base, salaryMinor: null, adjustments: [{ kind: "DEDUCTION", amountMinor: 999_999 }] }).overHalfMinor).toBe(0);
  });
});

describe("الأيّام والأشهر", () => {
  it("من عمل الشهرَ كلَّه يأخذ راتبه كاملاً، ومن نقص يوماً يأخذ بأيّامه", () => {
    expect(proratedSalary(310_000, { worked: 31, of: 31 })).toBe(310_000);
    expect(proratedSalary(310_000, { worked: 30, of: 31 })).toBe(300_000);
    expect(proratedSalary(null, { worked: 30, of: 31 })).toBeNull();
    expect(proratedSalary(310_000, null)).toBe(0);
  });

  it("الخارجُ في منتصف الشهر يُحسب إلى يوم خروجه، ومن خرج قبله لا يعمل فيه", () => {
    expect(workedDays({ hiredOn: "2026-01-01", leftOn: "2026-10-10" }, "2026-10")).toEqual({ worked: 10, of: 31 });
    expect(workedDays({ hiredOn: "2026-01-01", leftOn: "2026-10-10" }, "2026-09")).toEqual({ worked: 30, of: 30 });
    expect(activeIn({ hiredOn: "2026-01-01", leftOn: "2026-09-30" }, "2026-10")).toBe(false);
    expect(activeIn({ hiredOn: "2026-11-02", leftOn: null }, "2026-10")).toBe(false);
  });

  it("الراتبُ النافذ آخرُ ما بدأ قبل الشهر — مهما كان ترتيبُ الإدخال", () => {
    const rates = [{ fromMonth: "2026-09", amountMinor: 350_000 }, { fromMonth: "2026-05", amountMinor: 300_000 }, { fromMonth: "2026-12", amountMinor: 400_000 }];
    expect(rateFor(rates, "2026-10")).toBe(350_000);
    expect(rateFor(rates, "2026-04")).toBeNull();
  });

  it("حوالةُ اليوم العاشر للشهر السابق، والحادي عشر لشهرها — ويناير لديسمبر قبله", () => {
    expect(suggestedPayMonth("2026-10-10")).toBe("2026-09");
    expect(suggestedPayMonth("2026-10-11")).toBe("2026-10");
    expect(suggestedPayMonth("2027-01-03")).toBe("2026-12");
  });

  it("أسابيعُ الشهر: ما ينتهي سبتُه فيه، لا أكثر", () => {
    /* أكتوبر ٢٠٢٦: سبوتُه ٣ · ١٠ · ١٧ · ٢٤ · ٣١ */
    expect(weeksOfMonth("2026-10")).toEqual(["2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"]);
    /* فبراير ٢٠٢٦: أربعةُ سبوت */
    expect(weeksOfMonth("2026-02")).toHaveLength(4);
  });
});

describe("الساعاتُ نصّاً", () => {
  it("يرفض ما ليس ساعاتٍ كاملةَ الشكل — ولا يقرأ آخرَه", () => {
    expect(parseHours("x7:30")).toBeNull();
    expect(parseHours("7:300")).toBeNull();
    expect(parseHours("a7.5")).toBeNull();
    expect(parseHours("7.555")).toBeNull();
    expect(parseHours("0:00")).toBeNull();
    expect(parseHours("0")).toBeNull();
  });

  it("الساعاتُ بثلاث خاناتٍ والأرقامُ الفارسيّة والفراغ", () => {
    expect(parseHours("120:15")).toBe(120 * 60 + 15);
    expect(parseHours("120.5")).toBe(120 * 60 + 30);
    expect(parseHours(" ۷:۳۰ ")).toBe(450);
  });

  it("والعرضُ عكسُ القراءة", () => {
    expect(formatMinutes(450)).toBe("7:30");
    expect(formatMinutes(420)).toBe("7");
    expect(formatMinutes(65)).toBe("1:05");
  });
});

describe("مكافأة نهاية الخدمة — حدودُ السنين", () => {
  const salary = 365_000;
  it("سنتان بالضبط: ثلثُها، وقبلهما بيومٍ لا شيء", () => {
    const at2 = endOfService(salary, 2 * 365);
    expect(at2.resignationMinor).toBe(divRound(at2.fullMinor, 3));
    expect(endOfService(salary, 2 * 365 - 1).resignationMinor).toBe(0);
  });

  it("خمسٌ بالضبط: ثلثاها، وعشرٌ بالضبط: كاملة", () => {
    const at5 = endOfService(salary, 5 * 365);
    expect(at5.resignationMinor).toBe(divRound(at5.fullMinor * 2, 3));
    const before5 = endOfService(salary, 5 * 365 - 1);
    expect(before5.resignationMinor).toBe(divRound(before5.fullMinor, 3));
    const at10 = endOfService(salary, 10 * 365);
    expect(at10.resignationMinor).toBe(at10.fullMinor);
    const before10 = endOfService(salary, 10 * 365 - 1);
    expect(before10.resignationMinor).toBe(divRound(before10.fullMinor * 2, 3));
  });
});

describe("الحوالات والأغراض", () => {
  it("رقمُ المستفيد بلا نقطتين وبفراغات، واسمُه ما قبله بلا فراغ", () => {
    expect(beneficiaryIdOf("AHMED BENID 1129311518")).toBe("1129311518");
    expect(beneficiaryIdOf("AHMED BEN ID 1129311518")).toBe("1129311518");
    expect(beneficiaryNameOf("  ", "AHMED ALI BEN ID:1129")).toBe("AHMED ALI");
    expect(beneficiaryNameOf(null, "AHMED ALIBEN ID:1129")).toBe("AHMED ALI");
    expect(beneficiaryNameOf(null, "  BEN ID:1129")).toBeNull();
    expect(beneficiaryNameOf(" سعيد ", "X BEN ID:1")).toBe("سعيد");
    expect(beneficiaryNameOf(undefined, "no id here")).toBeNull();
  });

  it("الأنواعُ والأغراضُ المعروفة وحدها تُقبل", () => {
    for (const k of ["DEDUCTION", "FINE", "ADVANCE", "LOAN_REPAYMENT", "BONUS", "OVERTIME", "ALLOWANCE", "PAID_OUTSIDE"]) expect(isAdjustmentKind(k)).toBe(true);
    expect(isAdjustmentKind("SALARY")).toBe(false);
    expect(isAdjustmentKind(1)).toBe(false);
    for (const p of ["SALARY", "ADVANCE", "LOAN", "INVOICE", "EXPENSE", "PERSONAL"]) expect(isPurpose(p)).toBe(true);
    expect(isPurpose("BONUS")).toBe(false);
    expect(isPurpose(null)).toBe(false);
  });

  it("الإضافاتُ تزيد والخصومُ تُنقص بأنواعها", () => {
    const s = payslip({ ...base, adjustments: [
      { kind: "BONUS", amountMinor: 100 }, { kind: "OVERTIME", amountMinor: 200 }, { kind: "ALLOWANCE", amountMinor: 300 },
      { kind: "LOAN_REPAYMENT", amountMinor: 50 },
    ] });
    expect(s.additionsMinor).toBe(600);
    expect(s.manualDeductionsMinor).toBe(50);
  });

  it("السلفةُ والقرضُ رواتب في قائمة الدخل", () => {
    expect(reclassTarget("PERSONAL", "LOAN")).toBe("SALARY");
    expect(reclassTarget("PERSONAL", "ADVANCE")).toBe("SALARY");
    expect(reclassTarget("SALARY", "LOAN")).toBeNull();
  });

  it("القسمةُ على صفرٍ تُرمى ولا تُرجع لانهاية", () => {
    expect(() => divRound(1, 0)).toThrow(RangeError);
  });
});
