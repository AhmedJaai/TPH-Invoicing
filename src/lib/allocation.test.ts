import { describe, expect, it } from "vitest";
import { planAllocations, settleSupplierAccount } from "./allocation";

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

describe("سداد حساب المورّد — الأقدم أوّلاً", () => {
  const day = (d: string) => new Date(`${d}T00:00:00Z`);
  const inv = (id: string, date: string, out: number) =>
    ({ invoiceId: id, invoiceDate: day(date), outstandingMinor: out });

  it("ثلاث فواتير مجموعها المبلغ ← تُسدَّد كلّها والرصيد صفر", () => {
    /*
      وهذه الحالة الأساسية لا الطرفية: مورّدٌ عليه ٣٬٠٠٠ في ثلاث
      فواتير، وخرجت ٣٬٠٠٠ من البنك. ولا رقمَ فاتورةٍ في الحوالة.
    */
    const plan = settleSupplierAccount(3_000_00, day("2026-09-03"), [
      inv("a", "2026-08-05", 1_000_00),
      inv("b", "2026-08-12", 1_200_00),
      inv("c", "2026-08-20", 800_00),
    ]);
    expect(plan.allocations.map((a) => a.invoiceId)).toEqual(["a", "b", "c"]);
    expect(plan.allocatedMinor).toBe(3_000_00);
    expect(plan.remainingMinor).toBe(0);
  });

  it("الأقدم أوّلاً مهما كان ترتيب المدخل", () => {
    const plan = settleSupplierAccount(1_500_00, day("2026-09-03"), [
      inv("c", "2026-08-20", 800_00),
      inv("a", "2026-08-05", 1_000_00),
    ]);
    expect(plan.allocations[0].invoiceId).toBe("a");
    expect(plan.allocations[1]).toEqual({ invoiceId: "c", amountMinor: 500_00 });
  });

  it("ما زاد عن الفواتير يبقى غير مخصَّص — لا يُخلق له مقابل", () => {
    const plan = settleSupplierAccount(2_000_00, day("2026-09-03"), [
      inv("a", "2026-08-05", 500_00),
    ]);
    expect(plan.allocatedMinor).toBe(500_00);
    expect(plan.remainingMinor).toBe(1_500_00);
  });

  it("ولا تُسدَّد فاتورةٌ لم تكن قد وُجدت", () => {
    const plan = settleSupplierAccount(1_000_00, day("2026-09-03"), [
      inv("later", "2026-10-15", 1_000_00),
    ]);
    expect(plan.allocations).toHaveLength(0);
    expect(plan.remainingMinor).toBe(1_000_00);
  });

  it("والسبعةُ أيّام تسامحٌ: فاتورةٌ بعد الحوالة بيومين تُسدَّد", () => {
    const plan = settleSupplierAccount(1_000_00, day("2026-09-03"), [
      inv("near", "2026-09-05", 1_000_00),
    ]);
    expect(plan.allocatedMinor).toBe(1_000_00);
  });

  it("ولا يُخصَّص أكثر من الدفعة ولو كان المستحقّ أكبر", () => {
    const plan = settleSupplierAccount(1_000_00, day("2026-09-03"), [
      inv("a", "2026-08-01", 900_00),
      inv("b", "2026-08-02", 900_00),
    ]);
    expect(plan.allocatedMinor).toBe(1_000_00);
    expect(plan.shortfallMinor).toBe(800_00);
  });
});
