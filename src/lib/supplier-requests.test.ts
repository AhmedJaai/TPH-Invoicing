import { describe, expect, it } from "vitest";
import {
  buildInvoiceRequest, buildStatementRequest, groupUnbackedBySupplier, type UnbackedPayment,
} from "./supplier-requests";

const pay = (o: Partial<UnbackedPayment> & { paymentId: string }): UnbackedPayment => ({
  supplierId: "g", supplierName: "غاناش", supplierSlug: "Ganache",
  paidOn: "2026-08-03", amountMinor: 9_535_80, unbackedMinor: 8_505_40, bankTransactionId: null,
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
