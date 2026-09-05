import { describe, expect, it } from "vitest";
import {
  classifierSchema, fieldCount, invoiceExtractionSchema,
  receiptExtractionSchema, schemaFor, statementExtractionSchema,
} from "./schemas-by-kind";
import { extractionSchema } from "./schema";

describe("schemaFor", () => {
  it("الكشف يأخذ مخطّط الكشف", () => {
    expect(schemaFor("STATEMENT")).toBe(statementExtractionSchema);
  });

  it("الإيصالان يأخذان مخطّط الإيصال", () => {
    expect(schemaFor("RECEIPT")).toBe(receiptExtractionSchema);
    expect(schemaFor("CASH_RECEIPT")).toBe(receiptExtractionSchema);
  });

  it("الفاتورة وعرض السعر والمبدئية بمخطّط الفاتورة — شكلها واحد", () => {
    for (const k of ["TAX_INVOICE", "SIMPLIFIED_INVOICE", "QUOTATION", "PROFORMA"] as const) {
      expect(schemaFor(k)).toBe(invoiceExtractionSchema);
    }
  });
});

describe("التخصيص يختصر ما يُسأل عنه", () => {
  it("مخطّط الفاتورة أصغر من المخطّط الجامع", () => {
    const shared = Object.keys(extractionSchema.shape).length;
    expect(fieldCount("TAX_INVOICE")).toBeLessThan(shared);
  });

  it("الإيصال أصغرها — فهو أقلّها حقولاً في الواقع", () => {
    expect(fieldCount("RECEIPT")).toBeLessThan(fieldCount("TAX_INVOICE"));
  });

  it("لا يُسأل عن أرصدة كشفٍ في فاتورة", () => {
    const keys = Object.keys(invoiceExtractionSchema.shape);
    expect(keys).not.toContain("openingBalance");
    expect(keys).not.toContain("statementLines");
  });

  it("ولا عن بنود فاتورةٍ في كشف", () => {
    const keys = Object.keys(statementExtractionSchema.shape);
    expect(keys).not.toContain("lines");
    expect(keys).not.toContain("buyerVatNumber");
  });

  it("ولا عن مورّدٍ في إيصال — المستفيد يخالفه غالباً", () => {
    const keys = Object.keys(receiptExtractionSchema.shape);
    expect(keys).toContain("beneficiaryName");
    expect(keys).not.toContain("supplierNameAr");
  });
});

describe("المصنِّف", () => {
  it("يسأل سؤالاً واحداً بثلاثة حقول — فهو رخيص", () => {
    expect(Object.keys(classifierSchema.shape)).toEqual([
      "documentKind", "confidence", "reason",
    ]);
  });

  it("يقبل تصنيفاً صالحاً", () => {
    const r = classifierSchema.safeParse({
      documentKind: "TAX_INVOICE", confidence: 0.9, reason: "تحمل رقمنا الضريبي",
    });
    expect(r.success).toBe(true);
  });

  it("يرفض نوعاً مخترَعاً", () => {
    const r = classifierSchema.safeParse({
      documentKind: "SOMETHING", confidence: 1, reason: "",
    });
    expect(r.success).toBe(false);
  });
});
