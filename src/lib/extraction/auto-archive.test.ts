import { describe, expect, it } from "vitest";
import { autoArchive, GAP_TEXT, type AutoArchiveFacts } from "./auto-archive";

const clean: AutoArchiveFacts = {
  kind: "TAX_INVOICE",
  invoiceRecorded: true,
  textSource: "TEXT",
  supplierKnown: true,
  subtotalMinor: 40_000,
  vatMinor: 6_000,
  totalMinor: 46_000,
  invoiceNumber: "260387",
  fileName: "invoice.pdf",
};

describe("الأرشفةُ الآليّة", () => {
  it("نصٌّ مكتوب وحسابٌ مستقيم ومورّدٌ معروف — يدخل وحده", () => {
    expect(autoArchive(clean)).toEqual({ auto: true, gaps: [] });
  });

  it("الصورةُ تدخل إن صدّقها شاهد: ضريبةٌ ١٥٪ من الصافي", () => {
    expect(autoArchive({ ...clean, textSource: "PDF_EMBEDDED" }).auto).toBe(true);
    expect(autoArchive({ ...clean, textSource: null }).auto).toBe(true);
  });

  it("أو رقمُ الفاتورة في اسم الملفّ", () => {
    const zeroRated = { ...clean, textSource: "DIRECT", subtotalMinor: 46_000, vatMinor: 0 };
    expect(autoArchive({ ...zeroRated, fileName: "فاتورة - 260387 - مؤسسة ذا بوبليك هاوس.pdf" }).auto).toBe(true);
    expect(autoArchive({ ...zeroRated, invoiceNumber: "285558808", fileName: "print_invoice_13_09_2026_15_13_22_فاتورة285558808.pdf" }).auto).toBe(true);
  });

  it("وبلا شاهدٍ تبقى الصورةُ للإنسان — بسببها", () => {
    const v = autoArchive({ ...clean, textSource: "DIRECT", subtotalMinor: 46_000, vatMinor: 0 });
    expect(v.gaps).toEqual(["UNVERIFIED_IMAGE"]);
  });

  it("رقمٌ قصير لا يُعدّ شاهداً — «12» يقع في كلّ اسم", () => {
    const v = autoArchive({ ...clean, textSource: "DIRECT", subtotalMinor: 46_000, vatMinor: 0, invoiceNumber: "12", fileName: "2026-12-01.pdf" });
    expect(v.gaps).toEqual(["UNVERIFIED_IMAGE"]);
  });

  it("الحسابُ يُتسامَح فيه بريال — كما في القاعدة", () => {
    expect(autoArchive({ ...clean, totalMinor: 46_100 }).auto).toBe(true);
    expect(autoArchive({ ...clean, totalMinor: 46_101 }).gaps).toEqual(["ARITHMETIC"]);
  });

  it("والمجهولُ ليس استقامة", () => {
    expect(autoArchive({ ...clean, vatMinor: null }).gaps).toEqual(["ARITHMETIC"]);
  });

  it("المورّدُ المجهول لا يدخل", () => {
    expect(autoArchive({ ...clean, supplierKnown: false }).gaps).toEqual(["SUPPLIER_UNKNOWN"]);
  });

  it("والآليُّ للفواتير المقيَّدة وحدها", () => {
    expect(autoArchive({ ...clean, kind: "RECEIPT" }).gaps).toEqual(["NOT_INVOICE"]);
    expect(autoArchive({ ...clean, invoiceRecorded: false }).gaps).toEqual(["NOT_RECORDED"]);
  });

  it("والمبسّطةُ فاتورةٌ تُدفَع — تدخل كالضريبيّة", () => {
    expect(autoArchive({ ...clean, kind: "SIMPLIFIED_INVOICE" }).auto).toBe(true);
  });

  it("ولكلّ شرطٍ جملةٌ تُقال", () => {
    for (const text of Object.values(GAP_TEXT)) expect(text.length).toBeGreaterThan(10);
  });
});
