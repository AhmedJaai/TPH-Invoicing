import { describe, expect, it } from "vitest";
import { buildTaxInvoiceRequest } from "./vat-request";

describe("طلب فاتورة ضريبية من المورّد", () => {
  it("يسرد الفواتير الأقدم أوّلاً بما ينقصها، ويذكر رقمنا الضريبي", () => {
    const text = buildTaxInvoiceRequest({
      supplierName: "مورّد تجريبي", companyName: "مؤسسة تجريبية", companyVat: "300000000000003",
      invoices: [
        { number: "B-2", day: "2026-10-05", missing: ["رقمنا الضريبيّ"] },
        { number: "B-1", day: "2026-09-01", missing: [] },
      ],
    });
    expect(text).toContain("ورقمنا الضريبي 300000000000003");
    expect(text.indexOf("B-1")).toBeLessThan(text.indexOf("B-2"));
    expect(text).toContain("(ينقصها: رقمنا الضريبيّ)");
  });
});
