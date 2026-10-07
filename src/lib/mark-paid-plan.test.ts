import { describe, expect, it } from "vitest";
import { planHandPayments } from "./mark-paid-plan";

describe("planHandPayments — دفعةٌ لكلّ حوالة لا لكلّ فاتورة", () => {
  it("فاتورتان بالمبلغ نفسه لمورّدٍ واحد دفعةٌ واحدة بمجموعهما — لا توأمَين", () => {
    const plan = planHandPayments([
      { invoiceId: "a", supplierId: "bikov", periodMonth: "2026-08", restMinor: 15_000 },
      { invoiceId: "b", supplierId: "bikov", periodMonth: "2026-08", restMinor: 15_000 },
    ]);
    expect(plan).toEqual([{
      supplierId: "bikov",
      amountMinor: 30_000,
      appliesToMonth: "2026-08",
      allocations: [
        { invoiceId: "a", amountMinor: 15_000 },
        { invoiceId: "b", amountMinor: 15_000 },
      ],
    }]);
  });

  it("شهرُ الدفعة الأحدثُ بين فواتيرها", () => {
    const [p] = planHandPayments([
      { invoiceId: "a", supplierId: "s", periodMonth: "2026-09", restMinor: 100 },
      { invoiceId: "b", supplierId: "s", periodMonth: "2026-07", restMinor: 200 },
    ]);
    expect(p.appliesToMonth).toBe("2026-09");
    expect(p.amountMinor).toBe(300);
  });

  it("لكلّ مورّدٍ دفعتُه، وما لا مورّدَ له لا يُجمَع", () => {
    const plan = planHandPayments([
      { invoiceId: "a", supplierId: "s1", periodMonth: "2026-08", restMinor: 100 },
      { invoiceId: "b", supplierId: null, periodMonth: "2026-08", restMinor: 100 },
      { invoiceId: "c", supplierId: "s2", periodMonth: "2026-08", restMinor: 100 },
      { invoiceId: "d", supplierId: null, periodMonth: "2026-08", restMinor: 100 },
      { invoiceId: "e", supplierId: "s1", periodMonth: "2026-08", restMinor: 50 },
    ]);
    expect(plan.map((p) => [p.supplierId, p.amountMinor])).toEqual([
      ["s1", 150], [null, 100], ["s2", 100], [null, 100],
    ]);
  });

  it("ما سدّدته حوالةُ الكشف كلَّه لا يُكتب له شيء، ومجموعُ التخصيص يساوي الدفعة", () => {
    const plan = planHandPayments([
      { invoiceId: "a", supplierId: "s", periodMonth: "2026-08", restMinor: 0 },
      { invoiceId: "b", supplierId: "s", periodMonth: "2026-08", restMinor: 1 },
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].allocations).toEqual([{ invoiceId: "b", amountMinor: 1 }]);
    for (const p of plan) expect(p.allocations.reduce((s, a) => s + a.amountMinor, 0)).toBe(p.amountMinor);
    expect(planHandPayments([{ invoiceId: "a", supplierId: "s", periodMonth: "2026-08", restMinor: 0 }])).toEqual([]);
  });
});
