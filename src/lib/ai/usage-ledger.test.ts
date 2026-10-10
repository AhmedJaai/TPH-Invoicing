import { describe, expect, it } from "vitest";
import { budgetVerdict, dailyBudgetMicroUsd, formatUsd, toMicroUsd } from "./usage-ledger";

describe("دفتر إنفاق الذكاء", () => {
  it("الكلفةُ عددٌ صحيح يُقرَّب إلى الأعلى، والفاسدُ صفر", () => {
    expect(toMicroUsd(0.0000012)).toBe(2);
    expect(toMicroUsd(1.5)).toBe(1_500_000);
    expect(toMicroUsd(Number.NaN)).toBe(0);
    expect(toMicroUsd(-1)).toBe(0);
  });

  it("يُعرَض بخانتين", () => {
    expect(formatUsd(1_250_000)).toBe("1.25");
    expect(formatUsd(5_000)).toBe("0.01");
    expect(formatUsd(0)).toBe("0.00");
    expect(formatUsd(12_990_000)).toBe("12.99");
  });

  it("بلا ضبطٍ لا سقف — وما لا يُفهَم لا يصير صفراً يمنع كلَّ قراءة", () => {
    expect(dailyBudgetMicroUsd(undefined)).toBeNull();
    expect(dailyBudgetMicroUsd("")).toBeNull();
    expect(dailyBudgetMicroUsd("abc")).toBeNull();
    expect(dailyBudgetMicroUsd("0")).toBeNull();
    expect(dailyBudgetMicroUsd("5")).toBe(5_000_000);
  });

  it("بلا سقفٍ يمرّ كلُّ نداء، وبسقفٍ يُردّ ما بلغه برسالةٍ تقول كم وأين يُرفع", () => {
    expect(budgetVerdict(999_000_000, null)).toEqual({ allowed: true });
    expect(budgetVerdict(4_999_999, 5_000_000)).toEqual({ allowed: true });
    const over = budgetVerdict(5_000_000, 5_000_000);
    expect(over.allowed).toBe(false);
    if (!over.allowed) {
      expect(over.reason).toContain("5.00");
      expect(over.reason).toContain("AI_DAILY_BUDGET_USD");
    }
  });
});
