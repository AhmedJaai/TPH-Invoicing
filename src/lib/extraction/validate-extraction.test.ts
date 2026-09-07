import { describe, expect, it } from "vitest";
import { findConflicts, describeConflicts } from "./validate-extraction";
import type { ExtractionResult } from "./schema";

/** فاتورة سليمة يُبنى عليها، فيظهر أثر كل تعديل وحده. */
function invoice(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    documentKind: "TAX_INVOICE",
    supplierNameAr: "مؤسسة أوراق الزيتون",
    supplierNameEn: "Olive Leaves",
    sellerVatNumber: "310445566700003",
    sellerCrNumber: "4030112233",
    buyerNameAr: "مؤسسة ذا بوبليك هاوس",
    buyerVatNumber: "310007971600003",
    invoiceNumber: "OL-2026-0418",
    invoiceDate: "2026-08-14",
    subtotalAmount: "1000.00",
    vatAmount: "150.00",
    totalAmount: "1150.00",
    beneficiaryName: "",
    lines: [],
    openingBalance: "",
    closingBalance: "",
    statementLines: [],
    confidence: {
      documentKind: 1, supplierName: 1, invoiceNumber: 1,
      invoiceDate: 1, amounts: 1, vatNumbers: 1,
    },
    notes: "",
    ...over,
  };
}

describe("التحقّق من القراءة", () => {
  it("الفاتورة المستقيمة لا تعارض فيها", () => {
    expect(findConflicts(invoice())).toEqual([]);
  });

  it("يكشف أنّ الإجمالي لا يساوي الصافي زائد الضريبة", () => {
    const c = findConflicts(invoice({ totalAmount: "1200.00" }));
    expect(c.map((x) => x.code)).toContain("TOTAL_NOT_SUM");
  });

  it("يتسامح بريالٍ — المورّد يُسقط كسور الريال والمطبوع هو الملزِم", () => {
    /* ١٠٠٠ + ١٥٠ = ١١٥٠، والمطبوع ١١٤٩: فرقُ ريالٍ واحد */
    expect(findConflicts(invoice({ totalAmount: "1149.00" }))).toEqual([]);
  });

  it("يكشف نسبة ضريبةٍ تخالف ١٥٪", () => {
    const c = findConflicts(
      invoice({ subtotalAmount: "1000.00", vatAmount: "50.00", totalAmount: "1050.00" }),
    );
    expect(c.map((x) => x.code)).toContain("VAT_RATE_ODD");
  });

  it("يكشف بنداً حاصلُ ضربه لا يوافق مجموعه", () => {
    const c = findConflicts(
      invoice({
        lines: [{ description: "بنّ", quantity: "12", unitPrice: "85.00", lineTotal: "900.00" }],
      }),
    );
    expect(c.map((x) => x.code)).toContain("LINE_MATH");
  });

  it("يكشف مجموع بنودٍ لا يوافق الصافي", () => {
    const c = findConflicts(
      invoice({
        subtotalAmount: "1000.00",
        lines: [{ description: "بنّ", quantity: "1", unitPrice: "400.00", lineTotal: "400.00" }],
      }),
    );
    expect(c.map((x) => x.code)).toContain("LINES_NOT_SUBTOTAL");
  });

  it("يكشف تاريخاً ليس بالصيغة المطلوبة", () => {
    const c = findConflicts(invoice({ invoiceDate: "14/08/2026" }));
    expect(c.map((x) => x.code)).toContain("DATE_INVALID");
  });

  it("يكشف مبلغاً لا يُقرأ", () => {
    const c = findConflicts(invoice({ totalAmount: "غير واضح" }));
    expect(c.map((x) => x.code)).toContain("AMOUNT_UNREADABLE");
  });

  it("المجهول ليس تعارضاً — الحقل الفارغ لم يُقرأ ولا يُحاسَب", () => {
    expect(
      findConflicts(invoice({ subtotalAmount: "", vatAmount: "", totalAmount: "" })),
    ).toEqual([]);
  });

  /*
    الكشف والإيصال لا تُفرَض عليهما معادلة الفاتورة.

    الكشف مجموعُ حركاتٍ لا فاتورة، والإيصال مبلغٌ واحد محوَّل. وفرضُها
    عليهما يُنتج تعارضاً كاذباً يُعيد سؤال النموذج بلا سبب — وذلك كلفةٌ
    ووقتٌ على شيءٍ صحيح.
  */
  it("لا تُفرَض معادلة الفاتورة على كشف الحساب", () => {
    expect(
      findConflicts(invoice({ documentKind: "STATEMENT", totalAmount: "9999.00" })),
    ).toEqual([]);
  });

  it("ولا على إيصال التحويل", () => {
    expect(
      findConflicts(invoice({ documentKind: "RECEIPT", totalAmount: "9999.00" })),
    ).toEqual([]);
  });

  it("لا يزيد على ثلاثة تعارضات — الرسالة الطويلة تُشتّت كما يُشتّت المخطّط الضخم", () => {
    const many = findConflicts(
      invoice({
        invoiceDate: "خطأ",
        totalAmount: "5000.00",
        lines: Array.from({ length: 6 }, (_, i) => ({
          description: `بند ${i}`, quantity: "2", unitPrice: "10.00", lineTotal: "99.00",
        })),
      }),
    );
    expect(many.length).toBeLessThanOrEqual(3);
  });

  it("سؤال الإعادة يسمّي الحقول المختلّة وحدها", () => {
    const text = describeConflicts(findConflicts(invoice({ totalAmount: "1200.00" })));
    expect(text).toContain("subtotalAmount");
    expect(text).toContain("totalAmount");
    /* ولا يُطلَب تصحيحٌ — يُطلَب نقلُ ما هو مطبوع */
    expect(text).toContain("لا تحسب");
  });
});
