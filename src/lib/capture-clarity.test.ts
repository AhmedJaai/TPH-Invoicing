import { describe, expect, it } from "vitest";
import { judgeClarity } from "./capture-clarity";
import type { ExtractionResult } from "./extraction/schema";

const base: ExtractionResult = {
  documentKind: "TAX_INVOICE",
  supplierNameAr: "أوراق الزيتون", supplierNameEn: "Olive Leaves",
  sellerVatNumber: "310111111100003", sellerCrNumber: "",
  buyerNameAr: "ذا بوبليك هاوس", buyerVatNumber: "310007971600003",
  invoiceNumber: "260302", invoiceDate: "2026-08-17",
  subtotalAmount: "113.04", vatAmount: "16.96", discountAmount: "", chargesAmount: "", totalAmount: "130.00",
  beneficiaryName: "", lines: [],
  openingBalance: "", closingBalance: "", statementLines: [],
  confidence: { documentKind: 0.99, supplierName: 0.98, invoiceNumber: 0.97, invoiceDate: 0.99, amounts: 0.98, vatNumbers: 0.96 },
  notes: "",
};

describe("حكمُ الوضوح للباريستا", () => {
  it("الفاتورةُ المقروءة كاملةً واضحة، وما قُرئ يُعرض ليُقارَن بالورقة", () => {
    const v = judgeClarity(base);
    expect(v.level).toBe("CLEAR");
    expect(v.missing).toEqual([]);
    expect(v.read).toMatchObject({ supplier: "أوراق الزيتون", invoiceNumber: "260302", total: "130.00" });
  });

  it("الإجمالي الغائب يُسمّى باسمه — لا «غير واضحة» وحدها", () => {
    const v = judgeClarity({ ...base, totalAmount: "" });
    expect(v.level).toBe("PARTIAL");
    expect(v.missing).toEqual(["الإجمالي"]);
  });

  it("ما قرأه النموذج بثقةٍ ضعيفة لا يُعدّ مقروءاً", () => {
    const v = judgeClarity({ ...base, confidence: { ...base.confidence, amounts: 0.2 } });
    expect(v.read.total).toBeNull();
    expect(v.missing).toContain("الإجمالي");
  });

  it("الرقمُ وحده أو التاريخُ وحده يكفي ليُعرف أيّ فاتورة", () => {
    expect(judgeClarity({ ...base, invoiceNumber: "" }).level).toBe("CLEAR");
    expect(judgeClarity({ ...base, invoiceNumber: "", invoiceDate: "" }).missing).toEqual(["رقم الفاتورة وتاريخها"]);
  });

  it("المورّدُ يُعرف برقمه الضريبيّ إن لم يُقرأ اسمه", () => {
    expect(judgeClarity({ ...base, supplierNameAr: "", supplierNameEn: "" }).read.supplier).toBe("310111111100003");
  });

  it("الصورةُ التي لم يُقرأ منها شيء «لا تُقرأ»", () => {
    const v = judgeClarity({
      ...base, supplierNameAr: "", supplierNameEn: "", sellerVatNumber: "", invoiceNumber: "", invoiceDate: "", totalAmount: "",
    });
    expect(v.level).toBe("UNREADABLE");
  });

  it("الإجماليّ الصفريّ ليس قراءة", () => {
    expect(judgeClarity({ ...base, totalAmount: "0.00" }).read.total).toBeNull();
  });
});
