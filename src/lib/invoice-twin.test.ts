import { describe, expect, it } from "vitest";
import { autoRecordRefusal, findInvoiceTwin, invoiceNumberKey, twinReason, type RecordedInvoice } from "./invoice-twin";

const atlas: RecordedInvoice = {
  id: "i1", supplierId: "atlas", invoiceNumber: "INV-2026-05297", invoiceDate: "2026-08-13", totalMinor: 57_500,
};

describe("findInvoiceTwin — لا يُقيَّد ما قُيِّد", () => {
  it("الرقمُ نفسه بفواصل أخرى وحالةِ حروفٍ أخرى", () => {
    expect(invoiceNumberKey("INV/2026/05297")).toBe(invoiceNumberKey("inv 2026-05297"));
    expect(findInvoiceTwin([atlas], {
      supplierId: "atlas", invoiceNumber: "INV/2026/05297", invoiceDate: "2026-09-15", totalMinor: 1,
    })).toEqual({ kind: "same-number", invoice: atlas });
  });

  it("الأصفارُ في أوّل الرقم تبقى — 05297 غير 5297", () => {
    expect(invoiceNumberKey("INV-05297")).not.toBe(invoiceNumberKey("INV-5297"));
  });

  it("رقمٌ آخر باليوم والمبلغ نفسيهما — يُترك للإنسان", () => {
    const t = findInvoiceTwin([atlas], { supplierId: "atlas", invoiceNumber: "X-1", invoiceDate: "2026-08-13", totalMinor: 57_500 });
    expect(t?.kind).toBe("same-day-and-total");
    expect(twinReason(t!)).toContain("INV-2026-05297");
  });

  it("مورّدٌ آخر بالرقم نفسه ليس نسخة", () => {
    expect(findInvoiceTwin([atlas], {
      supplierId: "kohi", invoiceNumber: "INV-2026-05297", invoiceDate: "2026-08-13", totalMinor: 57_500,
    })).toBeNull();
  });

  it("الرقمُ الجديد نفسه بتاريخٍ آخر أو مبلغٍ آخر — فاتورةٌ جديدة", () => {
    expect(findInvoiceTwin([atlas], {
      supplierId: "atlas", invoiceNumber: "INV/2026/06519", invoiceDate: "2026-09-15", totalMinor: 57_500,
    })).toBeNull();
  });

  it("المجهولُ لا يُطابَق: بلا رقمٍ ولا مبلغ فلا توأم", () => {
    expect(findInvoiceTwin([atlas], { supplierId: "atlas", invoiceNumber: null, invoiceDate: "2026-08-13", totalMinor: null })).toBeNull();
  });
});

describe("autoRecordRefusal — بابُ القيد الآليّ الواحد", () => {
  const supplier = { id: "s1", nameAr: "أفال" };
  const recorded = [{ id: "i1", supplierId: "s1", invoiceNumber: "INV-2026-05297", invoiceDate: "2026-09-10", totalMinor: 1000_00 }];
  const base = { blockers: [], supplier, recorded, invoiceNumber: "X-1", invoiceDate: "2026-09-12", totalMinor: 50_00 };

  it("يُقيَّد ما سلم", () => expect(autoRecordRefusal(base)).toEqual([]));
  it("فاتورةٌ لغيرنا لا تُقيَّد", () =>
    expect(autoRecordRefusal({ ...base, blockers: [{ message: "الرقمُ الضريبيّ للمشتري ليس رقمنا" }] })).toEqual(["الرقمُ الضريبيّ للمشتري ليس رقمنا"]));
  it("الرقمُ نفسُه بصيغةٍ أخرى نسخةٌ لا فاتورة", () =>
    expect(autoRecordRefusal({ ...base, invoiceNumber: "INV/2026/05297" })[0]).toContain("نسخةٌ من فاتورة"));
  it("أوّلُ فاتورةٍ من مورّدٍ لا فاتورةَ له تُقيَّد بيد", () =>
    expect(autoRecordRefusal({ ...base, supplier: { id: "s2", nameAr: "سبعة جرة" } })[0]).toContain("أوّلُ فاتورةٍ"));
});
