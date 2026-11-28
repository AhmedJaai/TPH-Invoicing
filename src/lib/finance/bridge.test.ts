import { describe, expect, it } from "vitest";
import { buildPnl, type PnlInput } from "./pnl";
import { profitBridge } from "./bridge";

const june: PnlInput = {
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
  excluded: [], declaredNone: [], bankGapDays: 0,
};

const july: PnlInput = {
  ...june, month: "2026-07",
  revenue: { paidMinor: 10_350_000, vatMinor: 1_350_000, coveredDays: 31, expectedDays: 31 },
  cogs: { ...june.cogs, stock: { ...june.cogs.stock!, minor: 2_800_000 } },
  opex: [
    { category: "RENT", label: "إيجار", amountMinor: 800_000, source: "SPREAD" },
    { category: "SALARY", label: "رواتب", amountMinor: 1_500_000, source: "BANK" },
    { category: "UTILITY", label: "كهرباء", amountMinor: 40_000, source: "BANK" },
  ],
};

describe("لماذا تغيّر الربح", () => {
  it("مجموعُ الأسباب يساوي فرقَ الربح بالهللة، مرتّبةً بحجم الأثر", () => {
    const cur = buildPnl(july);
    const prev = buildPnl(june);
    const b = profitBridge(cur, prev)!;
    expect(b.changeMinor).toBe(cur.profitMinor! - prev.profitMinor!);
    expect(b.drivers.reduce((s, d) => s + d.impactMinor, 0)).toBe(b.changeMinor);
    expect(b.drivers.map((d) => d.id)).toEqual(["revenue", "op-SALARY", "cogs", "op-POS_FEE", "op-UTILITY"]);
    expect(b.drivers[0].impactMinor).toBe(-1_000_000);
    expect(b.drivers.find((d) => d.id === "cogs")!.impactMinor).toBe(200_000);
    /* بابٌ لم يكن في أحد الشهرين: مبلغُه هناك «غير معروف» لا صفر */
    expect(b.drivers.find((d) => d.id === "op-UTILITY")!.previousMinor).toBeNull();
    expect(b.drivers.find((d) => d.id === "op-POS_FEE")!.currentMinor).toBeNull();
    expect(b.caveats).toEqual([]);
  });

  it("ربحٌ مجهول في أحدهما: لا جسر", () => {
    const prev = buildPnl({ ...june, revenue: null });
    expect(profitBridge(buildPnl(july), prev)).toBeNull();
  });

  it("رقمان لا يشملان الشيء نفسه يُقال ذلك", () => {
    const noRent = { ...july, opex: july.opex.filter((o) => o.category !== "RENT") };
    const b = profitBridge(buildPnl(noRent), buildPnl(june))!;
    expect(b.caveats.some((c) => c.includes("الربح قبل الإيجار"))).toBe(true);
    const purchases = { ...july, cogs: { ...july.cogs, stock: null, stockMissing: "لا جرد" } };
    expect(profitBridge(buildPnl(purchases), buildPnl(june))!.caveats[0]).toContain("بطريقتين");
  });
});
