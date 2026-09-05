import { describe, expect, it } from "vitest";
import {
  absentFieldsFor, classifierSchema, fieldCount, invoiceExtractionSchema,
  receiptExtractionSchema, schemaFor, statementExtractionSchema, widen,
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

describe("التوسيع إلى الشكل الكامل", () => {
  /*
    `schemas-by-kind.ts` كان مكتوباً ومختبَراً ولا يستدعيه أحد: يُطلَب
    المخطّط الضخم لكلّ شيء. والتوسيع هو ما جعل استعمالَه ممكناً بلا
    تغيير كل ما بعده.
  */
  it("الفاتورة تُوسَّع فتُقبَل في المخطّط الكامل", () => {
    const wide = widen("TAX_INVOICE", {
      supplierNameAr: "أوراق الزيتون", supplierNameEn: "", sellerVatNumber: "310000000000003",
      sellerCrNumber: "", buyerNameAr: "ذا بوبليك هاوس", buyerVatNumber: "310007971600003",
      invoiceNumber: "260342", invoiceDate: "2026-08-10",
      subtotalAmount: "1000.00", vatAmount: "150.00", totalAmount: "1150.00",
      lines: [], confidence: { supplierName: 0.9, invoiceNumber: 0.95, invoiceDate: 0.9, amounts: 0.99, vatNumbers: 0.8 },
      notes: "",
    }, 0.97);

    const parsed = extractionSchema.parse(wide);
    expect(parsed.documentKind).toBe("TAX_INVOICE");
    expect(parsed.invoiceNumber).toBe("260342");
    /* ثقةُ التصنيف من المرحلة الأولى — لا يخمّنها مخطّطُ النوع */
    expect(parsed.confidence.documentKind).toBe(0.97);
  });

  it("الإيصال يسمّي تاريخه ورقمه بغير اسميهما فيُترجَمان", () => {
    const wide = widen("RECEIPT", {
      beneficiaryName: "سرد للتجارة", beneficiaryAccount: "", senderName: "",
      referenceNumber: "FT26001", transferDate: "2026-08-11", totalAmount: "11600.00",
      confidence: { supplierName: 0.7, invoiceNumber: 0.6, invoiceDate: 0.9, amounts: 0.99, vatNumbers: 0 },
      notes: "",
    }, 0.9);

    const parsed = extractionSchema.parse(wide);
    expect(parsed.beneficiaryName).toBe("سرد للتجارة");
    expect(parsed.invoiceNumber).toBe("FT26001");
    expect(parsed.invoiceDate).toBe("2026-08-11");
  });

  /*
    هذا هو لبّ التخصيص: الحقل الفارغ في المخطّط الواحد غامض — أفارغٌ
    لأنّه غير موجود أم لأنّه لم يُقرأ؟ وبعده صار الجواب معلوماً بالبناء.
  */
  it("ما لم يُسأل عنه يُقال إنّه لم يُسأل — لا يُخلَط بما لم يُقرأ", () => {
    const wide = widen("RECEIPT", { totalAmount: "100.00", notes: "" }, 0.9) as { notes: string };
    expect(wide.notes).toContain("لا يحملها هذا النوع");
    expect(wide.notes).toContain("statementLines");
    expect(wide.notes).toContain("lines");
  });

  it("والفاتورة لا تُسأل عن أرصدة كشف", () => {
    expect(absentFieldsFor("TAX_INVOICE")).toContain("openingBalance");
    expect(absentFieldsFor("TAX_INVOICE")).toContain("statementLines");
    expect(absentFieldsFor("TAX_INVOICE")).not.toContain("invoiceNumber");
  });

  it("والكشف لا يُسأل عن بنود فاتورة", () => {
    expect(absentFieldsFor("STATEMENT")).toContain("lines");
    expect(absentFieldsFor("STATEMENT")).not.toContain("openingBalance");
  });

  it("التوسيع لا يخترع قيمة", () => {
    const wide = widen("TAX_INVOICE", {}, 0.5) as Record<string, unknown>;
    expect(wide.supplierNameAr).toBe("");
    expect(wide.totalAmount).toBe("");
    expect(wide.lines).toEqual([]);
  });
});
