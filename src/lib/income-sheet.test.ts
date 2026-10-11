import { describe, expect, it } from "vitest";
import { buildIncomeSheet, invoiceNet, type IncomeSheetInput } from "./income-sheet";

const full: IncomeSheetInput = {
  revenue: { netMinor: 100_000_00, bankGrossMinor: 103_500_00, cashGrossMinor: 11_500_00, outputVatMinor: 15_000_00 },
  bankGapDays: 0,
  open: false,
  invoices: [
    { subtotalMinor: 20_000_00, vatMinor: 3_000_00, totalMinor: 23_000_00 },
    { subtotalMinor: null, vatMinor: 1_500_00, totalMinor: 11_500_00 },
  ],
  expenses: [{ category: "RENT", amountMinor: 15_000_00 }, { category: "SALARY", amountMinor: 25_000_00 }, { category: "شيءٌ جديد", amountMinor: 1_000_00 }],
};
const line = (s: ReturnType<typeof buildIncomeSheet>, id: string) => s.lines.find((l) => l.id === id);

describe("قائمة الدخل الناقصة المعلَنة", () => {
  it("صافي الفاتورة: المقروء، ثمّ الإجماليّ ناقصاً ضريبتَه، ثمّ الإجماليّ معلَناً", () => {
    expect(invoiceNet({ subtotalMinor: 100, vatMinor: 15, totalMinor: 115 })).toEqual({ minor: 100, grossOnly: false });
    expect(invoiceNet({ subtotalMinor: null, vatMinor: 15, totalMinor: 115 })).toEqual({ minor: 100, grossOnly: false });
    expect(invoiceNet({ subtotalMinor: null, vatMinor: null, totalMinor: 115 })).toEqual({ minor: 115, grossOnly: true });
  });

  it("شهرٌ مكتمل: الباقي = المبيعات − المشتريات − المصروفات، بالهللات", () => {
    const s = buildIncomeSheet(full);
    expect(s.purchasesMinor).toBe(30_000_00);
    expect(s.expensesMinor).toBe(41_000_00);
    expect(s.remainderMinor).toBe(29_000_00);
    expect(s.blockers).toEqual([]);
    expect(line(s, "cash-remainder")?.amountMinor).toBe(29_000_00);
    expect(line(s, "sales")?.amountMinor).toBe(100_000_00);
  });

  it("مجملُ الربح والربحُ التشغيليّ يبقيان غير معروفَين — المشترياتُ ليست تكلفةَ المبيعات", () => {
    const s = buildIncomeSheet(full);
    expect(line(s, "cogs")?.amountMinor).toBeNull();
    expect(line(s, "gross")?.amountMinor).toBeNull();
    expect(line(s, "operating-profit")?.amountMinor).toBeNull();
    expect(s.caveats[0]).toContain("ليست تكلفةَ المبيعات");
  });

  it("بابٌ غير معروف يُجمع في «أخرى» ولا يسقط من المجموع", () => {
    const s = buildIncomeSheet(full);
    expect(line(s, "op-OTHER")?.amountMinor).toBe(1_000_00);
    expect(line(s, "operating-total")?.amountMinor).toBe(41_000_00);
  });

  it("بلا مبيعات: المبيعاتُ والباقي غير معروفَين لا صفراً", () => {
    const s = buildIncomeSheet({ ...full, revenue: null });
    expect(line(s, "sales")?.amountMinor).toBeNull();
    expect(s.remainderMinor).toBeNull();
    expect(s.blockers[0]).toContain("لا مبيعات معروفة");
    expect(line(s, "cash-remainder")?.unavailableReason).toContain("لا مبيعات معروفة");
  });

  it("شهرٌ لم ينتهِ أو فيه أيّامٌ بلا كشف: لا يُحسب الباقي ويُقال لماذا", () => {
    expect(buildIncomeSheet({ ...full, open: true }).remainderMinor).toBeNull();
    const gap = buildIncomeSheet({ ...full, bankGapDays: 4 });
    expect(gap.remainderMinor).toBeNull();
    expect(gap.blockers).toEqual(["في الشهر 4 يوماً بلا كشف بنك — ما دخل وخرج فيها غير معروف"]);
    expect(buildIncomeSheet({ ...full, bankGapDays: null }).blockers[0]).toContain("لا كشفَ بنكٍ");
  });

  it("النقدُ غير المكتوب وفاتورةٌ بإجماليّها يُقالان مع الرقم", () => {
    const s = buildIncomeSheet({
      ...full,
      revenue: { netMinor: 90_000_00, bankGrossMinor: 103_500_00, cashGrossMinor: null, outputVatMinor: 13_500_00 },
      invoices: [{ subtotalMinor: null, vatMinor: null, totalMinor: 1_150_00 }],
    });
    expect(s.purchasesGrossOnlyCount).toBe(1);
    expect(s.caveats.some((c) => c.includes("لم يُكتب نقدٌ"))).toBe(true);
    expect(s.caveats.some((c) => c.includes("بإجماليّها"))).toBe(true);
  });

  it("الباقي قد يكون سالباً ولا يُقصّ", () => {
    const s = buildIncomeSheet({ ...full, revenue: { netMinor: 10_000_00, bankGrossMinor: 11_500_00, cashGrossMinor: 0, outputVatMinor: 1_500_00 } });
    expect(s.remainderMinor).toBe(-61_000_00);
  });
});
