import { describe, expect, it } from "vitest";
import { reviewConfirmed } from "./confirm";

const COMPANY_VAT = "310007971600003";
const SELLER_VAT = "300012345600003";

const validInvoice = {
  documentKind: "TAX_INVOICE",
  supplierId: "sup-1",
  invoiceNumber: "INV-100",
  invoiceDate: "2026-08-12",
  subtotalMinor: 10_000,
  vatMinor: 1_500,
  totalMinor: 11_500,
  sellerVat: SELLER_VAT,
  buyerVat: COMPANY_VAT,
};

describe("reviewConfirmed", () => {
  it("يعتمد الفاتورة المكتملة الأركان", () => {
    const r = reviewConfirmed(validInvoice, { companyVat: COMPANY_VAT });
    expect(r.blockers).toHaveLength(0);
    expect(r.taxStatus).toBe("VALID");
    expect(r.inputVatStatus).toBe("ELIGIBLE");
    expect(r.canCreateInvoice).toBe(true);
  });

  it("لا يصدّق راية المتصفّح: الفاتورة بلا رقم ضريبي للمشتري ليست صالحة للخصم", () => {
    const r = reviewConfirmed({ ...validInvoice, buyerVat: "" }, { companyVat: COMPANY_VAT });
    expect(r.taxStatus).not.toBe("VALID");
    expect(r.inputVatStatus).not.toBe("ELIGIBLE");
  });

  it("يمنع الأرشفة حين يخالف الرقم الضريبي للمشتري رقم المنشأة", () => {
    const r = reviewConfirmed(
      { ...validInvoice, buyerVat: "399999999900003" },
      { companyVat: COMPANY_VAT },
    );
    expect(r.blockers.some((b) => b.code === "BUYER_VAT_MISMATCH")).toBe(true);
  });

  it("يمنع عرض السعر من أن يُقيَّد فاتورةً", () => {
    const r = reviewConfirmed(
      { ...validInvoice, documentKind: "QUOTATION" },
      { companyVat: COMPANY_VAT },
    );
    expect(r.blockers.some((b) => b.code === "NOT_A_TAX_INVOICE")).toBe(true);
    expect(r.canCreateInvoice).toBe(false);
  });

  it("يرفض الفاتورة بلا رقم صراحةً بدل أن تُرفع بلا قيد", () => {
    const r = reviewConfirmed({ ...validInvoice, invoiceNumber: "  " }, { companyVat: COMPANY_VAT });
    expect(r.blockers.some((b) => b.code === "MISSING_INVOICE_NUMBER")).toBe(true);
    expect(r.canCreateInvoice).toBe(false);
  });

  it("يمنع الأرشفة بلا مورد", () => {
    const r = reviewConfirmed({ ...validInvoice, supplierId: null }, { companyVat: COMPANY_VAT });
    expect(r.blockers).not.toHaveLength(0);
    expect(r.canCreateInvoice).toBe(false);
  });

  it("يمنع الأرشفة بلا تاريخ صالح", () => {
    const r = reviewConfirmed({ ...validInvoice, invoiceDate: "12/08/2026" }, { companyVat: COMPANY_VAT });
    expect(r.blockers.some((b) => b.message.includes("تاريخ"))).toBe(true);
  });

  it("يمنع الأرشفة بلا مبلغ إجمالي", () => {
    const r = reviewConfirmed({ ...validInvoice, totalMinor: null }, { companyVat: COMPANY_VAT });
    expect(r.blockers.some((b) => b.message.includes("المبلغ"))).toBe(true);
  });

  it("يمنع تكرار رقم الفاتورة عند المورد نفسه", () => {
    const r = reviewConfirmed(validInvoice, {
      companyVat: COMPANY_VAT,
      duplicateInvoiceNumber: true,
    });
    expect(r.blockers.some((b) => b.code === "DUPLICATE_INVOICE")).toBe(true);
  });

  it("يرفع راية الأصل الثابت فوق ثلاثة آلاف ريال", () => {
    const r = reviewConfirmed(
      { ...validInvoice, subtotalMinor: 400_000, vatMinor: 60_000, totalMinor: 460_000 },
      { companyVat: COMPANY_VAT },
    );
    expect(r.isFixedAsset).toBe(true);
  });

  it("الإيصال لا يخضع للفحص الضريبي، ويُقبل بلا رقم فاتورة", () => {
    const r = reviewConfirmed(
      {
        documentKind: "RECEIPT",
        supplierId: "sup-1",
        invoiceDate: "2026-08-12",
        totalMinor: 500_00,
      },
      { companyVat: COMPANY_VAT },
    );
    expect(r.blockers).toHaveLength(0);
    expect(r.canCreateInvoice).toBe(false);
  });

  it("الكشف لا يخضع للفحص الضريبي", () => {
    const r = reviewConfirmed(
      {
        documentKind: "STATEMENT",
        supplierId: "sup-1",
        invoiceDate: "2026-08-31",
        totalMinor: 1_200_00,
      },
      { companyVat: COMPANY_VAT },
    );
    expect(r.blockers).toHaveLength(0);
  });

  it("ينبّه على المورد الذي لا يصدر فواتير وبلا عقد", () => {
    const r = reviewConfirmed(validInvoice, {
      companyVat: COMPANY_VAT,
      supplierIssuesInvoices: false,
      supplierContractOnFile: false,
    });
    expect(r.findings.some((f) => f.code === "SUPPLIER_WITHOUT_CONTRACT")).toBe(true);
  });
});
