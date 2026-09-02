import { describe, expect, it } from "vitest";
import { hasBlocker, isValidSaudiVat, validateInvoice } from "./validation";
import { ISSUE } from "./issue-codes";

const COMPANY_VAT = "310007971600003";
const ctx = { companyVat: COMPANY_VAT };
const codes = (r: ReturnType<typeof validateInvoice>) => r.findings.map((f) => f.code);

describe("الرقم الضريبي السعودي", () => {
  it("١٥ رقماً تبدأ بثلاثة وتنتهي بثلاثة", () => {
    expect(isValidSaudiVat(COMPANY_VAT)).toBe(true);
    expect(isValidSaudiVat("31000797160000")).toBe(false); // ١٤ رقماً
    expect(isValidSaudiVat("410007971600003")).toBe(false); // لا تبدأ بـ٣
    expect(isValidSaudiVat(null)).toBe(false);
  });
});

describe("الفاتورة الضريبية الكاملة", () => {
  it("تحمل الأركان الأربعة ← صالحة لخصم المدخلات", () => {
    const r = validateInvoice({
      kind: "TAX_INVOICE", invoiceNumber: "260302",
      sellerVat: "310111111100003", buyerVat: COMPANY_VAT,
      subtotalMinor: 10_000, vatMinor: 1_500, totalMinor: 11_500,
    }, ctx);
    expect(r.isTaxValid).toBe(true);
    expect(r.inputVatEligible).toBe(true);
    expect(r.findings).toHaveLength(0);
  });
});

describe("الفاتورة المبسطة", () => {
  it("بلا رقم ضريبي للمشتري ← تنبيه ولا خصم مدخلات", () => {
    const r = validateInvoice({
      kind: "SIMPLIFIED_INVOICE", invoiceNumber: "99",
      sellerVat: "310111111100003", buyerVat: null,
      subtotalMinor: 10_000, vatMinor: 1_500, totalMinor: 11_500,
    }, ctx);
    expect(r.inputVatEligible).toBe(false);
    expect(codes(r)).toContain(ISSUE.MISSING_BUYER_VAT);
    expect(hasBlocker(r.findings)).toBe(false);
  });
});

describe("رقم ضريبي لمنشأة أخرى", () => {
  it("يمنع القيد", () => {
    const r = validateInvoice({
      kind: "TAX_INVOICE", invoiceNumber: "99",
      sellerVat: "310111111100003", buyerVat: "310999999900003",
      subtotalMinor: 10_000, vatMinor: 1_500, totalMinor: 11_500,
    }, ctx);
    expect(codes(r)).toContain(ISSUE.BUYER_VAT_MISMATCH);
    expect(hasBlocker(r.findings)).toBe(true);
    expect(r.inputVatEligible).toBe(false);
  });

  it("يتجاهل المسافات والشرطات في المقارنة", () => {
    const r = validateInvoice({
      kind: "TAX_INVOICE", invoiceNumber: "99",
      sellerVat: "310111111100003", buyerVat: "3100-0797-1600-003",
      subtotalMinor: 10_000, vatMinor: 1_500, totalMinor: 11_500,
    }, ctx);
    expect(r.isTaxValid).toBe(true);
  });
});

describe("عرض السعر والمسودة", () => {
  it("لا يُقيَّد كفاتورة", () => {
    const r = validateInvoice({
      kind: "QUOTATION", invoiceNumber: "Q-1",
      sellerVat: "310111111100003", buyerVat: COMPANY_VAT,
      subtotalMinor: 10_000, vatMinor: 1_500, totalMinor: 11_500,
    }, ctx);
    expect(codes(r)).toContain(ISSUE.NOT_A_TAX_INVOICE);
    expect(hasBlocker(r.findings)).toBe(true);
    expect(r.isTaxValid).toBe(false);
  });
});

describe("الفحص الحسابي يكشف أخطاء الاستخراج", () => {
  it("يكشف مجموعاً لا يطابق الصافي زائد الضريبة", () => {
    // النمط الذي كلّفك: ٣٬٤٠٠ قُرئت ١٬٧٠٠
    const r = validateInvoice({
      kind: "TAX_INVOICE", invoiceNumber: "99",
      sellerVat: "310111111100003", buyerVat: COMPANY_VAT,
      subtotalMinor: 340_000, vatMinor: 51_000, totalMinor: 170_000,
    }, ctx);
    expect(codes(r)).toContain(ISSUE.VAT_MATH_MISMATCH);
  });

  it("يتسامح بهللة واحدة في تقريب المورد", () => {
    const r = validateInvoice({
      kind: "TAX_INVOICE", invoiceNumber: "99",
      sellerVat: "310111111100003", buyerVat: COMPANY_VAT,
      subtotalMinor: 3_333, vatMinor: 500, totalMinor: 3_833,
    }, ctx);
    expect(codes(r)).not.toContain(ISSUE.VAT_MATH_MISMATCH);
  });
});

describe("الأصل الثابت", () => {
  it("يرفع تنبيهاً فوق ٣٬٠٠٠ ريال على الصافي حين الضريبة قابلة للخصم", () => {
    const r = validateInvoice({
      kind: "TAX_INVOICE", invoiceNumber: "99",
      sellerVat: "310111111100003", buyerVat: COMPANY_VAT,
      subtotalMinor: 350_000, vatMinor: 52_500, totalMinor: 402_500,
    }, ctx);
    expect(r.isFixedAsset).toBe(true);
    expect(codes(r)).toContain(ISSUE.POSSIBLE_FIXED_ASSET);
  });

  it("لا يرفعه لصافٍ تحت الحد ولو تجاوز المجموع الحد بالضريبة", () => {
    const r = validateInvoice({
      kind: "TAX_INVOICE", invoiceNumber: "99",
      sellerVat: "310111111100003", buyerVat: COMPANY_VAT,
      subtotalMinor: 290_000, vatMinor: 43_500, totalMinor: 333_500,
    }, ctx);
    expect(r.isFixedAsset).toBe(false);
  });
});

describe("المورد الذي لا يصدر فواتير", () => {
  it("ينبّه ما لم يكن له عقد توريد", () => {
    const base = {
      kind: "SIMPLIFIED_INVOICE" as const, invoiceNumber: "1",
      sellerVat: null, buyerVat: null,
      subtotalMinor: 10_000, vatMinor: 0, totalMinor: 10_000,
    };
    const without = validateInvoice(base, { ...ctx, supplierIssuesInvoices: false });
    expect(codes(without)).toContain(ISSUE.SUPPLIER_WITHOUT_CONTRACT);

    const withContract = validateInvoice(base, {
      ...ctx, supplierIssuesInvoices: false, supplierContractOnFile: true,
    });
    expect(codes(withContract)).not.toContain(ISSUE.SUPPLIER_WITHOUT_CONTRACT);
  });
});

describe("ثقة الاستخراج", () => {
  it("يجمع الحقول منخفضة الثقة للمراجعة البشرية", () => {
    const r = validateInvoice({
      kind: "TAX_INVOICE", invoiceNumber: "99",
      sellerVat: "310111111100003", buyerVat: COMPANY_VAT,
      subtotalMinor: 10_000, vatMinor: 1_500, totalMinor: 11_500,
      fieldConfidence: { invoiceNumber: 0.55, totalMinor: 0.97, invoiceDate: 0.42 },
    }, ctx);
    expect(r.lowConfidenceFields).toEqual(["invoiceNumber", "invoiceDate"]);
    expect(codes(r)).toContain(ISSUE.LOW_CONFIDENCE_FIELD);
  });
});
