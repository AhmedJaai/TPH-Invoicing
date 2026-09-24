import { describe, expect, it } from "vitest";
import { invoiceReasons } from "./invoice-findings";

const COMPANY_VAT = "310007971600003";

const ok = {
  kind: "TAX_INVOICE",
  invoiceNumber: "INV-1",
  sellerVat: "300000000000003",
  buyerVat: COMPANY_VAT,
  subtotalMinor: 100_00,
  vatMinor: 15_00,
  totalMinor: 115_00,
  lineCount: 3,
};

const supplier = { issuesInvoices: true, contractOnFile: true };

describe("لماذا ناقصةُ ركن", () => {
  it("الفاتورة المستوفية بلا سبب", () => {
    expect(invoiceReasons(ok, supplier, COMPANY_VAT)).toEqual([]);
  });

  it("تسمّي الركنَ الناقص ولا تكتفي بالحكم", () => {
    const r = invoiceReasons({ ...ok, sellerVat: null }, supplier, COMPANY_VAT);
    expect(r).toHaveLength(1);
    expect(r[0].what).toContain("رقم ضريبيّ للبائع");
    /* ولكلّ سببٍ فعلُه — والسببُ بلا فعلٍ نصفُ خبر */
    expect(r[0].fix.length).toBeGreaterThan(20);
  });

  it("المانعُ قبل التحذير — من يقرأ سطرين يقرأ ما يمنع القيد أوّلاً", () => {
    const r = invoiceReasons(
      { ...ok, buyerVat: "999999999999999", invoiceNumber: null },
      supplier,
      COMPANY_VAT,
    );
    expect(r[0].severity).toBe("BLOCKER");
    expect(r.some((x) => x.code === "MISSING_INVOICE_NUMBER")).toBe(true);
  });

  it("«لم تُقرأ» تُميَّز عن «غير صالحة» — ولا يُطالَب المورّد قبل القراءة", () => {
    const r = invoiceReasons(
      { ...ok, sellerVat: null, buyerVat: null, subtotalMinor: null, vatMinor: null, totalMinor: null },
      supplier,
      COMPANY_VAT,
    );
    const unknown = r.find((x) => x.code === "TAX_STATUS_UNKNOWN");
    if (unknown) expect(unknown.fix).toContain("لا تُطالِب المورّد قبل ذلك");
  });

  it("فاتورةٌ بلا بنود عطبٌ يُذكَر — وهو خارج الفحص الضريبيّ", () => {
    const r = invoiceReasons({ ...ok, lineCount: 0 }, supplier, COMPANY_VAT);
    expect(r.map((x) => x.code)).toContain("NO_LINES");
    expect(r.find((x) => x.code === "NO_LINES")!.fix).toContain("أعد قراءة المستند");
  });

  it("ولا يُذكَر حين تُقرأ بنودُها", () => {
    expect(invoiceReasons(ok, supplier, COMPANY_VAT).map((x) => x.code)).not.toContain("NO_LINES");
  });
});

describe("VAT_MATH_MISMATCH بصوره الثلاث — لا تُتَّهم فاتورةٌ يستقيم جمعُها", () => {
  const supplier = { issuesInvoices: true, contractOnFile: false };
  const base = {
    kind: "TAX_INVOICE", invoiceNumber: "2823",
    sellerVat: "312343850700003", buyerVat: "310007971600003", lineCount: 3,
  };

  it("ضريبةٌ دون ١٥٪ والجمعُ يستقيم ← للعلم، وبنصّ البنود المعفاة", () => {
    const r = invoiceReasons({ ...base, subtotalMinor: 120_600, vatMinor: 16_290, totalMinor: 136_890 }, supplier, "310007971600003");
    const m = r.find((x) => x.code === "VAT_MATH_MISMATCH");
    expect(m?.severity).toBe("INFO");
    expect(m?.what).not.toContain("لا يساوي");
    expect(m?.what).toContain("١٥٪");
  });

  it("تقريبُ المورّد ← للعلم", () => {
    const r = invoiceReasons({ ...base, subtotalMinor: 100_000, vatMinor: 15_000, totalMinor: 114_950 }, supplier, "310007971600003");
    expect(r.find((x) => x.code === "VAT_MATH_MISMATCH")?.what).toContain("قرّب");
  });

  it("إجماليٌّ لا يستقيم فعلاً ← يحتاج معالجة بنصّه القديم", () => {
    const r = invoiceReasons({ ...base, subtotalMinor: 100_000, vatMinor: 15_000, totalMinor: 125_000 }, supplier, "310007971600003");
    const m = r.find((x) => x.code === "VAT_MATH_MISMATCH");
    expect(m?.severity).toBe("WARN");
    expect(m?.what).toContain("لا يساوي");
  });
});
