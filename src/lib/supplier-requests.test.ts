import { describe, expect, it } from "vitest";
import {
  buildInvoiceRequest, buildStatementRequest, groupUnbackedBySupplier, splitSupplierCredit, type UnbackedPayment, buildPriceRiseMessage, describeRequested, invoiceRequestKey, yearlyQuantity } from "./supplier-requests";

const pay = (o: Partial<UnbackedPayment> & { paymentId: string }): UnbackedPayment => ({
  supplierId: "g", supplierName: "غاناش", supplierSlug: "Ganache",
  paidOn: "2026-08-03", amountMinor: 9_535_80, unbackedMinor: 8_505_40, bankTransactionId: null,
  issuesInvoices: true,
  ...o,
});

describe("الدفعات بلا فاتورة مورّداً مورّداً (BTN-110)", () => {
  const groups = groupUnbackedBySupplier([
    pay({ paymentId: "1" }),
    pay({ paymentId: "2", paidOn: "2026-07-03", unbackedMinor: 7_603_80 }),
    pay({ paymentId: "3", supplierId: null, supplierName: null, supplierSlug: null, unbackedMinor: 30_000_00 }),
    pay({ paymentId: "4", supplierId: "l", supplierName: "لافا", supplierSlug: "Lava", unbackedMinor: 972_00 }),
  ]);

  it("لا تضيع دفعة — العدد في الوجهة هو عدد التنبيه", () => {
    expect(groups.flatMap((g) => g.payments)).toHaveLength(4);
  });

  it("الأثقل أوّلاً، وما لا مورّد له آخراً ولو كان أثقل", () => {
    expect(groups.map((g) => g.supplierName)).toEqual(["غاناش", "لافا", "بلا مورّد"]);
    expect(groups[0].totalMinor).toBe(8_505_40 + 7_603_80);
    expect(groups[0].payments.map((p) => p.paymentId)).toEqual(["2", "1"]);
  });

  it("رسالة الفاتورة تحمل كلّ حوالة وما بقي منها ورقمنا الضريبي", () => {
    const msg = buildInvoiceRequest(groups[0]);
    expect(msg).toContain("غاناش");
    expect(msg).toContain("2026-07-03");
    expect(msg).toContain("9,535.80");
    expect(msg).toContain("8,505.40");
    expect(msg).toContain("310007971600003");
  });

  it("رسالة الكشف تسمّي الشهر", () => {
    expect(buildStatementRequest("أوراق الزيتون", "2026-08")).toContain("2026-08");
  });
});

describe("المال نفسه باسم واحد (SCN-105)", () => {
  it("بلا مقدّمة معلنة: كلّه «دفعت له بلا فاتورة»", () => {
    expect(splitSupplierCredit(26_767_40, 0)).toEqual({ advanceMinor: 0, unbackedMinor: 26_767_40 });
  });
  it("المقدّمة وحدها «لك عنده»، ولا تتجاوز ما بقي", () => {
    expect(splitSupplierCredit(5_000_00, 2_000_00)).toEqual({ advanceMinor: 2_000_00, unbackedMinor: 3_000_00 });
    expect(splitSupplierCredit(1_000_00, 2_000_00)).toEqual({ advanceMinor: 1_000_00, unbackedMinor: 0 });
  });
  it("لا رصيد لا اسم", () => {
    expect(splitSupplierCredit(-5, 100)).toEqual({ advanceMinor: 0, unbackedMinor: 0 });
  });
});

describe("buildPriceRiseMessage", () => {
  const facts = {
    supplierName: "ألبان الواحة", itemName: "حليب 2ل", previousMinor: 11_50, currentMinor: 12_75,
    previousDay: "2026-08-03", currentDay: "2026-09-02", yearQuantity: 420,
  };

  it("السعران بتاريخيهما والزيادة والأثر السنويّ بالكمّيّة المشتراة", () => {
    const text = buildPriceRiseMessage(facts);
    expect(text).toContain("2026-08-03: 11.50");
    expect(text).toContain("2026-09-02: 12.75");
    expect(text).toContain("بزيادة 1.25");
    /* ١٫٢٥ × ٤٢٠ = ٥٢٥ */
    expect(text).toContain("525.00 ريال سنوياً");
  });

  it("كمّيّة مجهولة ⇒ لا أثر سنويّاً يقدّر", () => {
    expect(buildPriceRiseMessage({ ...facts, yearQuantity: null })).not.toContain("سنويّاً");
  });
});

describe("yearlyQuantity", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it("الكمّيّة على مدّتها ممدودةً إلى سنة", () => {
    expect(yearlyQuantity(100, d("2026-01-01"), d("2026-07-02"))).toBe(201);
  });
  it("مجهول الكمّيّة أو قصير التاريخ بلا معدّل", () => {
    expect(yearlyQuantity(null, d("2026-01-01"), d("2026-07-02"))).toBeNull();
    expect(yearlyQuantity(100, d("2026-06-01"), d("2026-07-02"))).toBeNull();
    expect(yearlyQuantity(100, null, d("2026-07-02"))).toBeNull();
  });
});

describe("سجلّ المطالبة", () => {
  const pay = (paymentId: string) => ({
    paymentId, supplierId: "s1", supplierName: "م", supplierSlug: "m", paidOn: "2026-09-01", amountMinor: 100, unbackedMinor: 100,
    bankTransactionId: null, issuesInvoices: true,
  });

  it("المفتاح من المورّد وأقدم دفعاته — ويتغيّر إن تغيّرت", () => {
    expect(invoiceRequestKey({ supplierId: "s1", payments: [pay("p1"), pay("p2")] })).toBe("supplier-request:s1:p1");
    expect(invoiceRequestKey({ supplierId: "s1", payments: [pay("p2")] })).toBe("supplier-request:s1:p2");
    expect(invoiceRequestKey({ supplierId: null, payments: [pay("p1")] })).toBeNull();
    expect(invoiceRequestKey({ supplierId: "s1", payments: [] })).toBeNull();
  });

  it("بعد أسبوع يقال «ذكّره»", () => {
    expect(describeRequested(0)).toBe("طُولب اليوم");
    expect(describeRequested(3)).toBe("طُولب قبل 3 أيام");
    expect(describeRequested(9)).toBe("طُولب قبل 9 أيام، وحان وقت التذكير");
  });
});
