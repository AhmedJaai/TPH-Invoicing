import { describe, expect, it } from "vitest";
import { bankAverages, buildCashNeed, coverageOf, type BankMonthRow, type CashNeedInput } from "./cash-need";
import type { RecurringInput } from "../cash-outlook";

const row = (month: string, category: string, minor: number, direction: "DEBIT" | "CREDIT" = "DEBIT"): BankMonthRow => ({ month, category, direction, minor });

describe("bankAverages — متوسط آخر ثلاثة أشهر كاملة", () => {
  const rows = [
    row("2026-08", "SUPPLIER", 53_076_22), row("2026-09", "SUPPLIER", 36_227_45), row("2026-10", "SUPPLIER", 30_483_49),
    row("2026-08", "UTILITY", 262_28), row("2026-09", "OTHER", 1_121_82), row("2026-10", "GOVERNMENT", 32_192_93),
    row("2026-10", "PERSONAL", 21_670_00), row("2026-10", "SALARY", 12_000_00), row("2026-10", "POS_SETTLEMENT", 90_000_00, "CREDIT"),
    row("2026-07", "SUPPLIER", 49_554_44),
  ];

  it("يقسم على ثلاثة، ولا يدخله شهرٌ قبلها", () => {
    const a = bankAverages(rows, "2026-11", "2026-10-30", new Set());
    expect(a.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(a.supplierPerMonthMinor).toBe(Math.round((53_076_22 + 36_227_45 + 30_483_49) / 3));
    expect(a.ownerDrawsPerMonthMinor).toBe(Math.round(21_670_00 / 3));
    expect(a.depositsPerMonthMinor).toBe(30_000_00);
    expect(a.salaryPerMonthMinor).toBe(4_000_00);
  });

  it("ما سجّله صاحبُه متكرّراً لا يُحسب مرّتين في المعتاد", () => {
    const all = bankAverages(rows, "2026-11", "2026-10-30", new Set());
    const noGov = bankAverages(rows, "2026-11", "2026-10-30", new Set(["GOVERNMENT"]));
    expect(all.usualPerMonthMinor).toBe(Math.round((262_28 + 1_121_82 + 32_192_93) / 3));
    expect(noGov.usualPerMonthMinor).toBe(Math.round((262_28 + 1_121_82) / 3));
  });

  it("كشفٌ لا يبلغ نهاية الشهر الأخير: المتوسطات «غير معروفة» لا أصفار", () => {
    const a = bankAverages(rows, "2026-11", "2026-10-12", new Set());
    expect(a).toMatchObject({ supplierPerMonthMinor: null, usualPerMonthMinor: null, ownerDrawsPerMonthMinor: null, salaryPerMonthMinor: null, depositsPerMonthMinor: null });
    expect(bankAverages(rows, "2026-11", null, new Set()).supplierPerMonthMinor).toBeNull();
  });
});

const semiRent: RecurringInput = { id: "rent", label: "الإيجار", amountMinor: 47_500_00, cadence: "SEMIANNUAL", startsOn: "2026-08-10", endsOn: null, category: "RENT" };
const water: RecurringInput = { id: "w", label: "مياه", amountMinor: 300_00, cadence: "MONTHLY", startsOn: "2026-01-05", endsOn: null, category: "UTILITY" };

const base: CashNeedInput = {
  today: "2026-11-01",
  overdueRunMinor: 20_000_00,
  nextRunKnownMinor: 9_000_00,
  supplierPerMonthMinor: 40_000_00,
  recurring: [],
  paidThisMonth: new Set(),
  payroll: [
    { month: "2026-11", amountMinor: 10_800_00, people: 6, unknownPeople: 0 },
    { month: "2026-12", amountMinor: 10_800_00, people: 6, unknownPeople: 0 },
    { month: "2027-01", amountMinor: 10_800_00, people: 6, unknownPeople: 0 },
  ],
  vat: [],
  upcoming: [],
  usualPerMonthMinor: 3_000_00,
};

describe("buildCashNeed — ثلاثة أشهر من اليوم", () => {
  it("المورّدون: المستحقُّ الآن معروف، وما بعده بالمتوسط أو بالمسجّل إن زاد عليه", () => {
    const plan = buildCashNeed(base);
    expect(plan.months).toEqual(["2026-11", "2026-12", "2027-01"]);
    const s = plan.rows.find((r) => r.key === "SUPPLIERS")!;
    expect(s.cells.map((c) => c.minor)).toEqual([20_000_00, 40_000_00, 40_000_00]);
    expect(s.cells.map((c) => c.estimate)).toEqual([false, true, true]);
    const bigger = buildCashNeed({ ...base, nextRunKnownMinor: 55_000_00 }).rows[0];
    expect(bigger.cells[1].minor).toBe(55_000_00);
  });

  it("بلا متوسط: الشهر الثاني بما سُجّل فقط، والثالث غير معروف لا صفر", () => {
    const plan = buildCashNeed({ ...base, supplierPerMonthMinor: null });
    const s = plan.rows[0];
    expect(s.cells[1]).toMatchObject({ minor: 9_000_00, estimate: false });
    expect(s.cells[2].minor).toBeNull();
    expect(plan.unknown).toContain("المورّدون — يناير 2027");
  });

  it("الإيجار المسجَّل كلَّ ستة أشهر لا يقع في الأشهر الثلاثة حتى يحلّ شهره، ويُذكر «بعدها مباشرة»", () => {
    const plan = buildCashNeed({
      ...base, recurring: [semiRent],
      upcoming: [{ label: "الإيجار", category: "RENT", coveredThrough: "2027-01", dueMonth: "2027-02", estimateMinor: 47_500_00, dueDay: "2027-02-10", scheduled: true }],
    });
    const fixed = plan.rows.find((r) => r.key === "FIXED")!;
    expect(fixed.cells.map((c) => c.minor)).toEqual([0, 0, 0]);
    expect(plan.beyond.map((b) => b.dueMonth)).toEqual(["2027-02"]);
  });

  it("وإذا وقع شهرُه داخل الأفق دخل مبلغُه المسجَّل بلا تقدير", () => {
    const plan = buildCashNeed({ ...base, today: "2027-01-05", recurring: [semiRent], payroll: [], overdueRunMinor: 0, nextRunKnownMinor: 0 });
    expect(plan.months).toEqual(["2027-01", "2027-02", "2027-03"]);
    const fixed = plan.rows.find((r) => r.key === "FIXED")!;
    expect(fixed.cells.map((c) => c.minor)).toEqual([0, 47_500_00, 0]);
    expect(fixed.cells[1].estimate).toBe(false);
  });

  it("غير المسجَّل: تقديرٌ بمبلغ آخر دفعة في شهره، ولا يُحسب إن سُجّل بابُه", () => {
    const upcoming = [{ label: "إيجار — دفعةُ أغسطس", category: "RENT", coveredThrough: "2026-12", dueMonth: "2027-01", estimateMinor: 47_500_00 }];
    const est = buildCashNeed({ ...base, upcoming }).rows.find((r) => r.key === "FIXED")!;
    expect(est.cells.map((c) => c.minor)).toEqual([0, 0, 47_500_00]);
    expect(est.cells[2].estimate).toBe(true);
    const reg = buildCashNeed({ ...base, upcoming, recurring: [{ ...semiRent, startsOn: "2026-07-10" }] }).rows.find((r) => r.key === "FIXED")!;
    /* مسجّلٌ يقع في يناير بـ occursIn ولا يُضاف التقدير فوقه */
    expect(reg.cells[2].minor).toBe(47_500_00);
  });

  it("المتكرّر الشهريّ كلَّ شهر، وما دُفع هذا الشهر لا يُعدّ ثانيةً", () => {
    const f = (paid: string[]) => buildCashNeed({ ...base, recurring: [water], paidThisMonth: new Set(paid) }).rows.find((r) => r.key === "FIXED")!.cells.map((c) => c.minor);
    expect(f([])).toEqual([300_00, 300_00, 300_00]);
    expect(f(["w"])).toEqual([0, 300_00, 300_00]);
  });

  it("الرواتب: الشهر الجاري معروف وما بعده تقدير، وشهرٌ بلا مسيّر غير معروف", () => {
    const plan = buildCashNeed({ ...base, payroll: base.payroll.filter((p) => p.month !== "2027-01") });
    const p = plan.rows.find((r) => r.key === "PAYROLL")!;
    expect(p.cells.map((c) => [c.minor, c.estimate])).toEqual([[10_800_00, false], [10_800_00, true], [null, true]]);
  });

  it("الضريبة: في شهر موعدها، وما فات موعدُه يدخل الشهر الأول، والمجهول غير معروف", () => {
    const plan = buildCashNeed({
      ...base,
      vat: [
        { periodKey: "2026-Q3", label: "الربع الثالث", deadline: "2026-10-31", amountMinor: 2_428_00, accruing: false },
        { periodKey: "2026-Q4", label: "الربع الرابع", deadline: "2027-01-31", amountMinor: 1_100_00, accruing: true },
      ],
    });
    const v = plan.rows.find((r) => r.key === "VAT")!;
    expect(v.cells.map((c) => c.minor)).toEqual([2_428_00, 0, 1_100_00]);
    expect(v.cells[2].estimate).toBe(true);
    const blind = buildCashNeed({ ...base, vat: [{ periodKey: "q", label: "ربع", deadline: "2027-01-31", amountMinor: null, accruing: false }] }).rows.find((r) => r.key === "VAT")!;
    expect(blind.cells[2].minor).toBeNull();
  });

  it("المجموع = مجموع المعروف والتقدير؛ والتقدير يُسمّى منفصلاً", () => {
    const plan = buildCashNeed(base);
    const known = 20_000_00 + 10_800_00 * 3;
    const est = 40_000_00 * 2 + 3_000_00 * 3;
    expect(plan.totalMinor).toBe(known + est);
    expect(plan.estimateMinor).toBe(40_000_00 * 2 + 3_000_00 * 3 + 10_800_00 * 2);
    expect(plan.monthTotals.reduce((s, x) => s + x, 0)).toBe(plan.totalMinor);
  });
});

describe("coverageOf", () => {
  it("الرصيد مقابل الحاجة، وبلا رصيد معروف لا حكم", () => {
    expect(coverageOf(100_00, 150_00)).toEqual({ gapMinor: 50_00, covered: true });
    expect(coverageOf(100_00, 40_00)).toEqual({ gapMinor: -60_00, covered: false });
    expect(coverageOf(100_00, null)).toBeNull();
  });
});
