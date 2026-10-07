import { describe, expect, it } from "vitest";
import { findConflicts, describeConflicts, deriveAmounts } from "./validate-extraction";
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
    discountAmount: "",
    chargesAmount: "",
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

  it("الخصمُ المطبوع بعد الضريبة يسدّ الفرق — لا تعارض", () => {
    /* ١٠٠٠ + ١٥٠ − ٥٠ = ١١٠٠ */
    expect(findConflicts(invoice({ totalAmount: "1100.00", discountAmount: "50.00" }))).toEqual([]);
    expect(findConflicts(invoice({ totalAmount: "1100.00", discountAmount: "20.00" })).map((x) => x.code)).toContain("TOTAL_NOT_SUM");
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

  it("يكشف تاريخاً لا يُفهَم — وما يفهمه الخادم بصيغةٍ أخرى لا يُدفع نداءٌ لإعادته", () => {
    expect(findConflicts(invoice({ invoiceDate: "منتصف أغسطس" })).map((x) => x.code)).toContain("DATE_INVALID");
    expect(findConflicts(invoice({ invoiceDate: "2026-02-30" })).map((x) => x.code)).toContain("DATE_INVALID");
    expect(findConflicts(invoice({ invoiceDate: "14/08/2026" }))).toEqual([]);
  });

  it("التاريخ الهجريّ المنقول كما طُبع لا يُعاد عنه السؤال — لا يُدفَع النموذج إلى تحويله", () => {
    expect(findConflicts(invoice({ invoiceDate: "1448-03-05" }), { today: "2026-10-07" })).toEqual([]);
  });

  it("تاريخٌ صحيحٌ في التقويم وليس معقولاً: بعد اليوم أو أقدم من سنةٍ ونصف", () => {
    const ctx = { today: "2026-10-07" };
    expect(findConflicts(invoice({ invoiceDate: "2062-09-13" }), ctx).map((x) => x.code)).toEqual(["DATE_IMPLAUSIBLE"]);
    expect(findConflicts(invoice({ invoiceDate: "2016-09-13" }), ctx).map((x) => x.code)).toEqual(["DATE_IMPLAUSIBLE"]);
    expect(findConflicts(invoice({ invoiceDate: "2026-10-07" }), ctx)).toEqual([]);
    expect(findConflicts(invoice({ invoiceDate: "2025-04-08" }), ctx)).toEqual([]);
    /* بلا «اليوم» لا يُحكم */
    expect(findConflicts(invoice({ invoiceDate: "2062-09-13" }))).toEqual([]);
  });

  it("رقمُ البائع الضريبيّ: شكلُه، وألّا يكون رقمَنا", () => {
    const ctx = { companyVat: "310007971600003" };
    expect(findConflicts(invoice({ sellerVatNumber: "31012239350000" }), ctx).map((x) => x.code)).toEqual(["VAT_FORMAT"]);
    expect(findConflicts(invoice({ sellerVatNumber: "310007971600003" }), ctx).map((x) => x.code)).toEqual(["PARTIES_SWAPPED"]);
    expect(findConflicts(invoice({ sellerVatNumber: "310122393500003" }), ctx)).toEqual([]);
    expect(findConflicts(invoice({ sellerVatNumber: "" }), ctx)).toEqual([]);
  });

  it("كمّيّةٌ بأرقامٍ عربيّة يُفحص حسابُ سطرها — وبأعدادٍ صحيحة", () => {
    const line = (quantity: string, lineTotal: string) =>
      findConflicts(invoice({ lines: [{ description: "بن", quantity, unitPrice: "45.00", lineTotal }] })).map((x) => x.code);
    expect(line("٢", "95.00")).toContain("LINE_MATH");
    expect(line("٢", "90.00")).not.toContain("LINE_MATH");
    expect(line("١٢٫٥", "562.50")).not.toContain("LINE_MATH");
    expect(line("2.5 كجم", "112.50")).not.toContain("LINE_MATH");
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

describe("اشتقاق الصافي", () => {
  it("يُشتقّ حين يغيب والإجمالي والضريبة معلومان", () => {
    const r = deriveAmounts(invoice({ subtotalAmount: "", vatAmount: "150.00", totalAmount: "1150.00" }));
    expect(r.subtotalAmount).toBe("1000.00");
  });

  it("والفاتورة بلا ضريبة صافيها إجماليها — وهي ٥٦ فاتورة في الأرشيف", () => {
    const r = deriveAmounts(invoice({ subtotalAmount: "", vatAmount: "0.00", totalAmount: "280.00" }));
    expect(r.subtotalAmount).toBe("280.00");
  });

  it("ولا يُمَسّ صافٍ مقروء", () => {
    const r = deriveAmounts(invoice({ subtotalAmount: "999.00", vatAmount: "150.00", totalAmount: "1150.00" }));
    expect(r.subtotalAmount).toBe("999.00");
  });

  it("ولا يُشتقّ من مجهول — المجهول ليس صفراً", () => {
    expect(deriveAmounts(invoice({ subtotalAmount: "", vatAmount: "", totalAmount: "1150.00" })).subtotalAmount).toBe("");
    expect(deriveAmounts(invoice({ subtotalAmount: "", vatAmount: "150.00", totalAmount: "" })).subtotalAmount).toBe("");
  });

  it("ولا يُشتقّ صافٍ سالب — ضريبةٌ تفوق الإجمالي قراءةٌ خاطئة لا حساب", () => {
    const r = deriveAmounts(invoice({ subtotalAmount: "", vatAmount: "2000.00", totalAmount: "1150.00" }));
    expect(r.subtotalAmount).toBe("");
  });
});
