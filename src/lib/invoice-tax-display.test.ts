import { describe, expect, it } from "vitest";
import { isUntaxedInvoice } from "./invoice-tax-display";

describe("isUntaxedInvoice — مورّدٌ بلا شهادة ضريبيّة", () => {
  const base = { vatMinor: 0, sellerVat: null, supplierVat: null };
  it("بلا رقمٍ ضريبيّ للمورّد وضريبتُها صفر: بلا ضريبة", () => {
    expect(isUntaxedInvoice(base)).toBe(true);
    expect(isUntaxedInvoice({ ...base, vatMinor: null })).toBe(true);
  });
  it("رقمٌ قُرئ بعشر خانات (سجلٌّ تجاريّ) ليس رقماً ضريبيّاً", () => {
    expect(isUntaxedInvoice({ ...base, sellerVat: "7052766941" })).toBe(true);
  });
  it("مورّدٌ مسجَّلٌ ضريبتُه صفرٌ مقروءةً: عطبٌ لا يُخفى", () => {
    expect(isUntaxedInvoice({ ...base, supplierVat: "310111111100003" })).toBe(false);
  });
  it("وفاتورةٌ عليها ضريبة، أو رقمُ بائعٍ صالح: ليست «بلا ضريبة»", () => {
    expect(isUntaxedInvoice({ ...base, vatMinor: 1500 })).toBe(false);
    expect(isUntaxedInvoice({ ...base, sellerVat: "310111111100003" })).toBe(false);
  });
});
