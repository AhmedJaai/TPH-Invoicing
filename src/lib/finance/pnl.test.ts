import { describe, expect, it } from "vitest";
import { buildPnl, isTaxSettlement, monthsBetween, spreadShare, type PnlInput } from "./pnl";

const base: PnlInput = {
  month: "2026-06", open: false,
  revenue: { paidMinor: 11_500_000, vatMinor: 1_500_000, coveredDays: 30, expectedDays: 30 },
  cogs: {
    purchasesMinor: 3_400_000, purchasesInvoices: 46, purchasesGrossOnly: 0,
    theoreticalMinor: 2_500_000,
    stock: { minor: 3_000_000, openingDay: "2026-05-30", closingDay: "2026-06-27", adjustedDays: 4, countedItems: 30, openingValueMinor: 900_000, closingValueMinor: 1_300_000, suspectItems: [] },
    stockMissing: null, foodicsMinor: 1_800_000, wasteMinor: 100_000, staffMinor: 30_000,
  },
  opex: [
    { category: "RENT", label: "إيجار", amountMinor: 800_000, source: "SPREAD" },
    { category: "SALARY", label: "رواتب", amountMinor: 1_200_000, source: "BANK" },
    { category: "POS_FEE", label: "رسوم", amountMinor: 120_000, source: "BANK" },
  ],
  excluded: [], declaredNone: [], bankGapDays: 0, ownerDrawsMinor: 2_000_000,
};

describe("قائمةُ الدخل", () => {
  it("شهرٌ كامل: صافي الربح باسمه", () => {
    const p = buildPnl(base);
    expect(p.revenueMinor).toBe(10_000_000);
    expect(p.cogsMethod).toBe("STOCK");
    expect(p.grossProfitMinor).toBe(7_000_000);
    expect(p.grossMarginBp).toBe(7000);
    expect(p.opexMinor).toBe(2_120_000);
    expect(p.profitMinor).toBe(4_880_000);
    expect(p.profitLabel).toBe("صافي الربح");
    expect(p.complete).toBe(true);
    expect(p.gaps).toEqual([]);
    /* الجرد − النظريّة − الهدر */
    expect(p.unexplainedMinor).toBe(400_000);
  });
  it("بلا إيجار: «الربح قبل الإيجار» لا «صافي الربح» — وسطرُه غير معروف لا صفر", () => {
    const p = buildPnl({ ...base, opex: base.opex.filter((o) => o.category !== "RENT") });
    expect(p.profitLabel).toBe("الربح قبل الإيجار");
    expect(p.complete).toBe(false);
    expect(p.gaps.map((g) => g.id)).toEqual(["RENT"]);
    expect(p.lines.find((l) => l.id === "op-RENT")?.amountMinor).toBeNull();
  });
  it("وبلا الاثنين يُسمَّيان معاً", () => {
    const p = buildPnl({ ...base, opex: base.opex.filter((o) => o.category === "POS_FEE") });
    expect(p.profitLabel).toBe("الربح قبل الإيجار والرواتب");
  });
  it("«لا يوجد» بإقرار المالك يُكمل الشهر", () => {
    const p = buildPnl({ ...base, opex: base.opex.filter((o) => o.category !== "RENT"), declaredNone: ["RENT"] });
    expect(p.profitLabel).toBe("صافي الربح");
    expect(p.complete).toBe(true);
  });
  it("إيجارٌ دفعةً من الكشف لم يُوزَّع: يُسأل عنه ولا يُقال «مكتمل»", () => {
    const p = buildPnl({ ...base, opex: base.opex.map((o) => (o.category === "RENT" ? { ...o, source: "BANK" as const } : o)) });
    expect(p.gaps.map((g) => g.id)).toEqual(["RENT_LUMP"]);
    expect(p.complete).toBe(false);
    expect(p.profitLabel).toBe("صافي الربح — غير مكتمل");
  });
  it("فرقٌ سالب يُسمّى خطأَ بياناتٍ لا ربحاً", () => {
    const p = buildPnl({ ...base, cogs: { ...base.cogs, theoreticalMinor: 3_500_000 } });
    expect(p.unexplainedMinor).toBe(-600_000);
    expect(p.lines.find((l) => l.id === "cogs-unexplained")?.label).toContain("فاتورةٌ لم تُقيَّد");
  });
  it("بلا عدّ: التكلفةُ مشترياتُ الشهر ويُقال ذلك في اسم الرقم", () => {
    const p = buildPnl({ ...base, cogs: { ...base.cogs, stock: null, stockMissing: "لا عدَّ في أوّل الشهر" } });
    expect(p.cogsMethod).toBe("PURCHASES");
    expect(p.cogsMinor).toBe(3_400_000);
    expect(p.profitLabel).toBe("صافي الربح — بتكلفة المشتريات");
    expect(p.complete).toBe(false);
    expect(p.unexplainedMinor).toBeNull();
  });
  it("بلا مبيعات: الربحُ غير معروف لا سالب", () => {
    const p = buildPnl({ ...base, revenue: null });
    expect(p.revenueMinor).toBeNull();
    expect(p.profitMinor).toBeNull();
    expect(p.gaps[0].id).toBe("NO_REVENUE");
  });
  it("شهرٌ لم ينتهِ وأيّامٌ بلا كشف: يُقالان", () => {
    expect(buildPnl({ ...base, open: true }).profitLabel).toBe("صافي الربح — حتى اليوم");
    const p = buildPnl({ ...base, bankGapDays: 5 });
    expect(p.profitLabel).toBe("صافي الربح — غير مكتمل");
    expect(p.complete).toBe(false);
  });
});

describe("التوزيعُ على أشهر", () => {
  it("مجموعُ الحصص هو المبلغُ بالهللة", () => {
    const months = monthsBetween("2026-08", "2027-01");
    expect(months).toHaveLength(6);
    const shares = months.map((m) => spreadShare(4_750_001, "2026-08", "2027-01", m));
    expect(shares.reduce((s, x) => s + x, 0)).toBe(4_750_001);
    expect(shares[0]).toBe(791_666);
    expect(spreadShare(4_750_000, "2026-08", "2027-01", "2026-07")).toBe(0);
  });
});

it("سدادُ هيئة الزكاة والضريبة ليس مصروفاً", () => {
  expect(isTaxSettlement("Zakat, Tax and Customs Au thority رقم السداد310007971626300")).toBe(true);
  expect(isTaxSettlement("Ministry of Municipal and Rural Affairs")).toBe(false);
});
