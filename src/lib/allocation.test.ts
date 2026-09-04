import { describe, expect, it } from "vitest";
import { planAllocations } from "./allocation";

const req = (invoiceId: string, amountMinor: number) => ({ invoiceId, amountMinor });

describe("planAllocations", () => {
  it("الدفعة الكافية تُخصَّص كاملةً", () => {
    const p = planAllocations(100_000, 0, [req("a", 60_000), req("b", 40_000)]);
    expect(p.allocatedMinor).toBe(100_000);
    expect(p.remainingMinor).toBe(0);
    expect(p.shortfallMinor).toBe(0);
    expect(p.allocations).toHaveLength(2);
  });

  it("لا يُخصَّص أكثر من قيمة الدفعة — ولو بهللة", () => {
    // الحالة الحقيقية: حوالة ١٥٠٠٫٠٠ وفاتورة ١٥٠٠٫٠١
    const p = planAllocations(150_000, 0, [req("sardco", 150_001)]);
    expect(p.allocatedMinor).toBe(150_000);
    expect(p.allocations[0].amountMinor).toBe(150_000);
    expect(p.shortfallMinor).toBe(1);
  });

  it("ما خُصّص سابقاً يُخصم من المتاح", () => {
    const p = planAllocations(100_000, 70_000, [req("a", 50_000)]);
    expect(p.allocatedMinor).toBe(30_000);
    expect(p.shortfallMinor).toBe(20_000);
  });

  it("الدفعة المستنفدة لا تُخصَّص شيئاً", () => {
    const p = planAllocations(100_000, 100_000, [req("a", 50_000)]);
    expect(p.allocations).toHaveLength(0);
    expect(p.allocatedMinor).toBe(0);
    expect(p.shortfallMinor).toBe(50_000);
  });

  it("التخصيص السابق الذي يتجاوز الدفعة لا يُنتج متاحاً سالباً", () => {
    const p = planAllocations(100_000, 150_000, [req("a", 10_000)]);
    expect(p.remainingMinor).toBe(0);
    expect(p.allocatedMinor).toBe(0);
  });

  it("يُخصَّص بالترتيب حتى تنفد الدفعة", () => {
    const p = planAllocations(100_000, 0, [req("a", 60_000), req("b", 60_000)]);
    expect(p.allocations).toEqual([
      { invoiceId: "a", amountMinor: 60_000 },
      { invoiceId: "b", amountMinor: 40_000 },
    ]);
    expect(p.shortfallMinor).toBe(20_000);
  });

  it("الطلب بصفر أو سالب يُتجاهَل ولا يكسر الحساب", () => {
    const p = planAllocations(100_000, 0, [req("a", 0), req("b", -500), req("c", 30_000)]);
    expect(p.allocations).toHaveLength(1);
    expect(p.allocatedMinor).toBe(30_000);
  });

  it("بلا طلبات لا يُخصَّص شيء ويبقى كامل المبلغ", () => {
    const p = planAllocations(100_000, 0, []);
    expect(p.allocatedMinor).toBe(0);
    expect(p.remainingMinor).toBe(100_000);
  });
});
