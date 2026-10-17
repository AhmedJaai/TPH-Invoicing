import { describe, expect, it } from "vitest";
import { planAllocations, settleSupplierAccount } from "./allocation";

const req = (invoiceId: string, amountMinor: number) => ({ invoiceId, amountMinor });

describe("planAllocations", () => {
  it("الدفعة الكافية تخصّص كاملةً", () => {
    const p = planAllocations(100_000, 0, [req("a", 60_000), req("b", 40_000)]);
    expect(p.allocatedMinor).toBe(100_000);
    expect(p.remainingMinor).toBe(0);
    expect(p.shortfallMinor).toBe(0);
    expect(p.allocations).toHaveLength(2);
  });

  it("لا يخصّص أكثر من قيمة الدفعة — ولو بهللة", () => {
    // الحالة الحقيقية: حوالة ١٥٠٠٫٠٠ وفاتورة ١٥٠٠٫٠١
    const p = planAllocations(150_000, 0, [req("sardco", 150_001)]);
    expect(p.allocatedMinor).toBe(150_000);
    expect(p.allocations[0].amountMinor).toBe(150_000);
    expect(p.shortfallMinor).toBe(1);
  });

  it("ما خصّص سابقاً يخصم من المتاح", () => {
    const p = planAllocations(100_000, 70_000, [req("a", 50_000)]);
    expect(p.allocatedMinor).toBe(30_000);
    expect(p.shortfallMinor).toBe(20_000);
  });

  it("الدفعة المستنفدة لا تخصّص شيئاً", () => {
    const p = planAllocations(100_000, 100_000, [req("a", 50_000)]);
    expect(p.allocations).toHaveLength(0);
    expect(p.allocatedMinor).toBe(0);
    expect(p.shortfallMinor).toBe(50_000);
  });

  it("التخصيص السابق الذي يتجاوز الدفعة لا ينتج متاحاً سالباً", () => {
    const p = planAllocations(100_000, 150_000, [req("a", 10_000)]);
    expect(p.remainingMinor).toBe(0);
    expect(p.allocatedMinor).toBe(0);
  });

  it("يخصّص بالترتيب حتى تنفد الدفعة", () => {
    const p = planAllocations(100_000, 0, [req("a", 60_000), req("b", 60_000)]);
    expect(p.allocations).toEqual([
      { invoiceId: "a", amountMinor: 60_000 },
      { invoiceId: "b", amountMinor: 40_000 },
    ]);
    expect(p.shortfallMinor).toBe(20_000);
  });

  it("الطلب بصفر أو سالب يتجاهل ولا يكسر الحساب", () => {
    const p = planAllocations(100_000, 0, [req("a", 0), req("b", -500), req("c", 30_000)]);
    expect(p.allocations).toHaveLength(1);
    expect(p.allocatedMinor).toBe(30_000);
  });

  it("بلا طلبات لا يخصّص شيء ويبقى كامل المبلغ", () => {
    const p = planAllocations(100_000, 0, []);
    expect(p.allocatedMinor).toBe(0);
    expect(p.remainingMinor).toBe(100_000);
  });
});

describe("سداد حساب المورّد — الأقدم أوّلاً", () => {
  const day = (d: string) => new Date(`${d}T00:00:00Z`);
  const inv = (id: string, date: string, out: number) =>
    ({ invoiceId: id, invoiceDate: day(date), outstandingMinor: out });

  it("ثلاث فواتير مجموعها المبلغ ← تسدّد كلّها والرصيد صفر", () => {
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

  it("ما زاد عن الفواتير يبقى غير مخصّص — لا يخلق له مقابل", () => {
    const plan = settleSupplierAccount(2_000_00, day("2026-09-03"), [
      inv("a", "2026-08-05", 500_00),
    ]);
    expect(plan.allocatedMinor).toBe(500_00);
    expect(plan.remainingMinor).toBe(1_500_00);
  });

  it("ولا تسدّد فاتورة لم تكن قد وجدت", () => {
    const plan = settleSupplierAccount(1_000_00, day("2026-09-03"), [
      inv("later", "2026-10-15", 1_000_00),
    ]);
    expect(plan.allocations).toHaveLength(0);
    expect(plan.remainingMinor).toBe(1_000_00);
  });

  it("والسبعة أيّام تسامح: فاتورة بعد الحوالة بيومين تسدّد", () => {
    const plan = settleSupplierAccount(1_000_00, day("2026-09-03"), [
      inv("near", "2026-09-05", 1_000_00),
    ]);
    expect(plan.allocatedMinor).toBe(1_000_00);
  });

  it("ولا يخصّص أكثر من الدفعة ولو كان المستحقّ أكبر", () => {
    const plan = settleSupplierAccount(1_000_00, day("2026-09-03"), [
      inv("a", "2026-08-01", 900_00),
      inv("b", "2026-08-02", 900_00),
    ]);
    expect(plan.allocatedMinor).toBe(1_000_00);
    expect(plan.shortfallMinor).toBe(800_00);
  });
});

import { planCreditApplication } from "./allocation";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("planCreditApplication — رصيدنا عند المورّد على فواتيره", () => {
  it("حوالة سبقت فواتيرها بأيّام تخصم منها آلياً (لوريفا)", () => {
    const plan = planCreditApplication(
      [{ paymentId: "p", paidAt: d("2026-09-02"), availableMinor: 63_250 }],
      [
        { invoiceId: "si45", invoiceDate: d("2026-09-04"), outstandingMinor: 37_950 },
        { invoiceId: "si46", invoiceDate: d("2026-09-04"), outstandingMinor: 37_950 },
        { invoiceId: "si51", invoiceDate: d("2026-09-07"), outstandingMinor: 25_300 },
      ],
      { forwardDays: 7 },
    );
    expect(plan.appliedMinor).toBe(63_250);
    expect(plan.allocations).toEqual([
      { paymentId: "p", invoiceId: "si45", amountMinor: 37_950 },
      { paymentId: "p", invoiceId: "si46", amountMinor: 25_300 },
    ]);
    expect(plan.creditLeftMinor).toBe(0);
    expect(plan.openLeftMinor).toBe(12_650 + 25_300);
  });

  it("لا يخصم آلياً ما جاوز سبعة أيّام — ذاك قرار إنسان", () => {
    const plan = planCreditApplication(
      [{ paymentId: "p", paidAt: d("2026-07-04"), availableMinor: 750_000 }],
      [{ invoiceId: "july", invoiceDate: d("2026-07-15"), outstandingMinor: 1_200_313 }],
      { forwardDays: 7 },
    );
    expect(plan.allocations).toHaveLength(0);
    expect(plan.creditLeftMinor).toBe(750_000);
  });

  it("بإقرار إنسان تخصم بلا نافذة، الأقدم على الأقدم (الكوب الذهبي بعد قيد مايو من حساب المالك)", () => {
    const plan = planCreditApplication(
      [
        { paymentId: "t0719", paidAt: d("2026-07-19"), availableMinor: 450_313 },
        { paymentId: "t0704", paidAt: d("2026-07-04"), availableMinor: 750_000 },
        { paymentId: "t0818", paidAt: d("2026-08-18"), availableMinor: 115_000 },
        { paymentId: "t0903", paidAt: d("2026-09-03"), availableMinor: 20_125 },
      ],
      [{ invoiceId: "july", invoiceDate: d("2026-07-15"), outstandingMinor: 1_200_313 }],
      { forwardDays: null },
    );
    expect(plan.appliedMinor).toBe(1_200_313);
    expect(plan.allocations.map((a) => a.paymentId)).toEqual(["t0704", "t0719"]);
    expect(plan.creditLeftMinor).toBe(135_125);
    expect(plan.openLeftMinor).toBe(0);
  });

  it("لا يخصم أكثر من المتاح ولا أكثر من المفتوح", () => {
    const plan = planCreditApplication(
      [{ paymentId: "p", paidAt: d("2026-08-01"), availableMinor: 100 }],
      [{ invoiceId: "i", invoiceDate: d("2026-08-01"), outstandingMinor: 40 }],
      { forwardDays: 7 },
    );
    expect(plan.appliedMinor).toBe(40);
    expect(plan.creditLeftMinor).toBe(60);
  });

  it("الرصيد الصفريّ والفاتورة المسدّدة لا يدخلان", () => {
    const plan = planCreditApplication(
      [{ paymentId: "p", paidAt: d("2026-08-01"), availableMinor: 0 }],
      [{ invoiceId: "i", invoiceDate: d("2026-08-01"), outstandingMinor: 0 }],
      { forwardDays: null },
    );
    expect(plan.allocations).toHaveLength(0);
  });
});
