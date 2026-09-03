import { describe, expect, it } from "vitest";
import { buildPaymentRun, buildSupplierMessage, toBankTransferCsv, type PayableInvoice } from "./payment-run";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const inv = (o: Partial<PayableInvoice> & { invoiceId: string }): PayableInvoice => ({
  supplierId: "s1", supplierName: "أوراق الزيتون",
  invoiceNumber: o.invoiceId, invoiceDate: d("2026-08-15"),
  periodMonth: "2026-08", totalMinor: 10_000, allocatedMinor: 0,
  isTaxValid: true, inputVatEligible: true, vatMinor: 1_500,
  ...o,
});

describe("دفعة أوّل الشهر", () => {
  it("تجمع مستحقّات الشهر لكل مورّد", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "1", totalMinor: 10_000 }),
      inv({ invoiceId: "2", totalMinor: 5_000 }),
      inv({ invoiceId: "3", supplierId: "s2", supplierName: "بيكوف", totalMinor: 30_000 }),
    ], "2026-08");

    expect(run.ready).toHaveLength(2);
    expect(run.ready[0].supplierName).toBe("بيكوف"); // الأكبر أوّلاً
    expect(run.ready[1].totalMinor).toBe(15_000);
    expect(run.readyTotalMinor).toBe(45_000);
  });

  it("تستبعد المسدَّد وتُدرج باقي المسدَّد جزئياً", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "paid", totalMinor: 10_000, allocatedMinor: 10_000 }),
      inv({ invoiceId: "partial", totalMinor: 10_000, allocatedMinor: 4_000 }),
    ], "2026-08");

    expect(run.ready[0].invoiceCount).toBe(1);
    expect(run.readyTotalMinor).toBe(6_000);
  });

  it("تتسامح بهللة تقريب فلا تُدرج المسدَّدة", () => {
    const run = buildPaymentRun([inv({ invoiceId: "x", totalMinor: 10_000, allocatedMinor: 9_999 })], "2026-08");
    expect(run.ready).toHaveLength(0);
  });

  it("تقتصر على الشهر المطلوب افتراضياً", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "aug", periodMonth: "2026-08" }),
      inv({ invoiceId: "jul", periodMonth: "2026-07" }),
    ], "2026-08");
    expect(run.ready[0].invoiceCount).toBe(1);
  });

  it("تضمّ المتأخّرات عند الطلب", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "aug", periodMonth: "2026-08" }),
      inv({ invoiceId: "jul", periodMonth: "2026-07" }),
      inv({ invoiceId: "sep", periodMonth: "2026-09" }),
    ], "2026-08", { includeOlderUnpaid: true });
    // أغسطس وما قبله فقط — لا سبتمبر
    expect(run.ready[0].invoiceCount).toBe(2);
  });
});

describe("حجز غير الصالح ضريبياً", () => {
  it("يمنع سداد ما ليس فاتورة ضريبية", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "ok" }),
      inv({ invoiceId: "bad", isTaxValid: false, inputVatEligible: false, vatMinor: 3_000 }),
    ], "2026-08");

    expect(run.ready[0].invoiceCount).toBe(1);
    expect(run.held).toHaveLength(1);
    expect(run.held[0].reason).toBe("NOT_TAX_VALID");
    expect(run.held[0].message).toContain("قبل السداد");
    expect(run.vatAtRiskMinor).toBe(3_000);
  });

  it("يحجز ما لا يصلح لخصم المدخلات ولو كان ضريبياً شكلاً", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "x", isTaxValid: true, inputVatEligible: false }),
    ], "2026-08");
    expect(run.held[0].reason).toBe("NO_VAT_DEDUCTION");
    expect(run.ready).toHaveLength(0);
  });

  it("يحسب إجمالي المحجوز", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "a", isTaxValid: false, totalMinor: 20_000 }),
      inv({ invoiceId: "b", isTaxValid: false, totalMinor: 5_000, allocatedMinor: 2_000 }),
    ], "2026-08");
    expect(run.heldTotalMinor).toBe(23_000);
  });
});

describe("ملف التحويلات", () => {
  const run = buildPaymentRun([
    inv({ invoiceId: "1", invoiceNumber: "260302", totalMinor: 13_000 }),
    inv({ invoiceId: "2", invoiceNumber: "260310", totalMinor: 41_000 }),
  ], "2026-08");

  it("يحمل المستفيد والمبلغ وأرقام الفواتير", () => {
    const csv = toBankTransferCsv(run);
    expect(csv).toContain("أوراق الزيتون");
    expect(csv).toContain("540.00");
    expect(csv).toContain("260302 | 260310");
    expect(csv).toContain("SAR");
  });

  it("يبدأ بعلامة ترميز ليقرأه إكسل العربي", () => {
    expect(toBankTransferCsv(run).charCodeAt(0)).toBe(0xfeff);
  });

  it("يحمي الفواصل داخل الأسماء", () => {
    const tricky = buildPaymentRun([
      inv({ invoiceId: "1", supplierName: 'مؤسسة "أ, ب"' }),
    ], "2026-08");
    const line = toBankTransferCsv(tricky).split("\r\n")[1];
    expect(line.startsWith('"مؤسسة ""أ, ب"""')).toBe(true);
  });
});

describe("رسالة المورّد", () => {
  it("تسرد أرقام الفواتير الناقصة وتطلب البديل", () => {
    const run = buildPaymentRun([
      inv({ invoiceId: "1", invoiceNumber: "990", isTaxValid: false }),
    ], "2026-08");
    const msg = buildSupplierMessage("بيكوف", run.held);
    expect(msg).toContain("بيكوف");
    expect(msg).toContain("990");
    expect(msg).toContain("310007971600003");
  });
});
