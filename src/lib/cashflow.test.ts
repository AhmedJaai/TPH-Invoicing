import { describe, expect, it } from "vitest";
import {
  buildCashFlow, buildProfitLoss, compareExpenses, monthlyShare,
  type CashMovement, type RecurringExpense,
} from "./cashflow";

const mv = (
  month: string, direction: "DEBIT" | "CREDIT",
  category: CashMovement["category"], amountMinor: number,
): CashMovement => ({ month, direction, category, amountMinor });

describe("buildCashFlow", () => {
  it("يفصل الوارد عن الصادر ويحسب الصافي", () => {
    const c = buildCashFlow([
      mv("2026-08", "CREDIT", "INTERNAL", 100_000),
      mv("2026-08", "DEBIT", "SUPPLIER", 40_000),
      mv("2026-08", "DEBIT", "RENT", 10_000),
    ]);
    expect(c.months[0].inMinor).toBe(100_000);
    expect(c.months[0].outMinor).toBe(50_000);
    expect(c.months[0].netMinor).toBe(50_000);
  });

  it("يرتّب الأشهر زمنياً", () => {
    const c = buildCashFlow([
      mv("2026-09", "DEBIT", "RENT", 1),
      mv("2026-07", "DEBIT", "RENT", 1),
      mv("2026-08", "DEBIT", "RENT", 1),
    ]);
    expect(c.months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("يجمع حسب التصنيف ويرتّبه بالأكبر", () => {
    const c = buildCashFlow([
      mv("2026-08", "DEBIT", "RENT", 10_000),
      mv("2026-08", "DEBIT", "SALARY", 50_000),
      mv("2026-08", "DEBIT", "SALARY", 20_000),
    ]);
    expect(c.months[0].byCategory[0]).toEqual({ category: "SALARY", amountMinor: 70_000 });
  });

  it("يُعلن غير المصنَّف لأنّه يُضعف الثقة", () => {
    const c = buildCashFlow([
      mv("2026-08", "DEBIT", "UNKNOWN", 30_000),
      mv("2026-08", "DEBIT", "RENT", 10_000),
    ]);
    expect(c.unclassifiedMinor).toBe(30_000);
    expect(c.unclassifiedCount).toBe(1);
  });

  it("بلا حركات لا يكسر الحساب", () => {
    const c = buildCashFlow([]);
    expect(c.months).toHaveLength(0);
    expect(c.netMinor).toBe(0);
  });
});

describe("buildProfitLoss", () => {
  const base = {
    netSalesMinor: null,
    purchasesMinor: 130_000,
    operatingByCategory: [
      { category: "SALARY" as const, amountMinor: 60_000 },
      { category: "RENT" as const, amountMinor: 40_000 },
    ],
  };

  it("بلا مبيعات: الإيراد فارغ بسببه لا صفر", () => {
    const pl = buildProfitLoss(base);
    const sales = pl.lines.find((l) => l.id === "sales")!;
    expect(sales.amountMinor).toBeNull();
    expect(sales.unavailableReason).toContain("غير موصولة");
  });

  it("لا تُعرض تكلفة مبيعات من المشتريات — الفرق بينهما المخزون", () => {
    const cogs = buildProfitLoss(base).lines.find((l) => l.id === "cogs")!;
    expect(cogs.amountMinor).toBeNull();
    expect(cogs.unavailableReason).toContain("المخزون");
  });

  it("مجمل الربح والربح التشغيلي غير متاحين ولا يُحسبان صفراً", () => {
    const pl = buildProfitLoss(base);
    expect(pl.lines.find((l) => l.id === "gross")!.amountMinor).toBeNull();
    expect(pl.lines.find((l) => l.id === "operating-profit")!.amountMinor).toBeNull();
  });

  it("المصروفات التشغيلية تُجمع وتُرتَّب بالأكبر", () => {
    const pl = buildProfitLoss(base);
    const total = pl.lines.find((l) => l.id === "operating-total")!;
    expect(total.amountMinor).toBe(100_000);
    const first = pl.lines.findIndex((l) => l.id === "op-SALARY");
    const second = pl.lines.findIndex((l) => l.id === "op-RENT");
    expect(first).toBeLessThan(second);
  });

  it("القائمة تُعلن ما ينقصها", () => {
    const pl = buildProfitLoss(base);
    expect(pl.complete).toBe(false);
    expect(pl.missing).toContain("المبيعات");
    expect(pl.missing).toContain("المخزون");
  });

  it("بمبيعات موصولة يظهر الإيراد رقماً", () => {
    const pl = buildProfitLoss({ ...base, netSalesMinor: 500_000 });
    expect(pl.lines.find((l) => l.id === "sales")!.amountMinor).toBe(500_000);
  });
});

describe("monthlyShare", () => {
  const e = (cadence: RecurringExpense["cadence"], amountMinor: number): RecurringExpense => ({
    id: "x", label: "إيجار", category: "RENT", amountMinor, cadence,
  });

  it("الشهري كما هو", () => expect(monthlyShare(e("MONTHLY", 10_000))).toBe(10_000));
  it("الربعي على ثلاثة", () => expect(monthlyShare(e("QUARTERLY", 30_000))).toBe(10_000));
  it("السنوي على اثني عشر", () => expect(monthlyShare(e("ANNUAL", 120_000))).toBe(10_000));
});

describe("compareExpenses", () => {
  const rent: RecurringExpense = { id: "r", label: "إيجار المحل", category: "RENT", amountMinor: 950_000, cadence: "ANNUAL" };

  it("يقابل المتوقَّع بالفعلي ويحسب الفرق", () => {
    const c = compareExpenses([rent], [{ category: "RENT", amountMinor: 80_000 }]);
    expect(c[0].expectedMinor).toBe(79_167);
    expect(c[0].actualMinor).toBe(80_000);
    expect(c[0].overspent).toBe(true);
  });

  it("تصنيف بلا مصروف متوقَّع يظهر بمتوقَّع صفر — وذلك صادق", () => {
    const c = compareExpenses([], [{ category: "SALARY", amountMinor: 60_000 }]);
    expect(c[0].expectedMinor).toBe(0);
    expect(c[0].varianceMinor).toBe(60_000);
  });

  it("مصروف متوقَّع لم يُصرف يظهر بفعليّ صفر", () => {
    const c = compareExpenses([rent], []);
    expect(c[0].actualMinor).toBe(0);
    expect(c[0].overspent).toBe(false);
  });

  it("يرتّب بأكبر فرق ليُنظَر فيه أوّلاً", () => {
    const c = compareExpenses(
      [rent, { id: "s", label: "اشتراك", category: "UTILITY", amountMinor: 1_000, cadence: "MONTHLY" }],
      [{ category: "RENT", amountMinor: 200_000 }, { category: "UTILITY", amountMinor: 1_100 }],
    );
    expect(c[0].category).toBe("RENT");
  });
});
