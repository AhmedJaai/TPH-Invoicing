import { describe, expect, it } from "vitest";
import { autoArchive, GAP_TEXT, type AutoArchiveFacts } from "./auto-archive";

const clean: AutoArchiveFacts = {
  kind: "TAX_INVOICE",
  invoiceRecorded: true,
  textSource: "TEXT",
  supplierKnown: true,
  sellerVat: "300123456700003",
  supplierVat: "300123456700003",
  subtotalMinor: 40_000,
  vatMinor: 6_000,
  totalMinor: 46_000,
};

describe("الأرشفةُ الآليّة — أربعةُ شروطٍ معاً", () => {
  it("اجتمعت الأربعة فيدخل وحده", () => {
    expect(autoArchive(clean)).toEqual({ auto: true, gaps: [], learnVat: null });
  });

  it("الصورةُ الممسوحة لا تدخل وحدها — ولو استقام كلُّ ما عداها", () => {
    const v = autoArchive({ ...clean, textSource: "PDF_EMBEDDED" });
    expect(v.auto).toBe(false);
    expect(v.gaps).toEqual(["NOT_TEXT"]);
  });

  it("رقمٌ ضريبيّ يخالف المسجَّل — فاتورةٌ من غير من نظنّ", () => {
    expect(autoArchive({ ...clean, sellerVat: "399999999900003" }).gaps).toEqual(["VAT_MISMATCH"]);
  });

  it("والرقمُ الغائب ليس مطابقة — من أيّ الطرفين غاب", () => {
    expect(autoArchive({ ...clean, sellerVat: null }).gaps).toEqual(["VAT_UNKNOWN"]);
    expect(autoArchive({ ...clean, supplierVat: "" }).gaps).toEqual(["VAT_UNKNOWN"]);
  });

  it("والفراغُ داخل الرقم لا يُفرّق", () => {
    expect(autoArchive({ ...clean, sellerVat: "3001 2345 6700 003" }).auto).toBe(true);
  });

  it("الحسابُ يُتسامَح فيه بريال — كما في القاعدة", () => {
    expect(autoArchive({ ...clean, totalMinor: 46_100 }).auto).toBe(true);
    expect(autoArchive({ ...clean, totalMinor: 46_101 }).gaps).toEqual(["ARITHMETIC"]);
  });

  it("والمجهولُ ليس استقامة", () => {
    expect(autoArchive({ ...clean, vatMinor: null }).gaps).toEqual(["ARITHMETIC"]);
  });

  it("المورّدُ المجهول لا يدخل", () => {
    expect(autoArchive({ ...clean, supplierKnown: false, supplierVat: null }).gaps)
      .toEqual(["SUPPLIER_UNKNOWN", "VAT_UNKNOWN"]);
  });

  it("والآليُّ للفواتير المقيَّدة وحدها", () => {
    expect(autoArchive({ ...clean, kind: "RECEIPT" }).gaps).toEqual(["NOT_INVOICE"]);
    expect(autoArchive({ ...clean, invoiceRecorded: false }).gaps).toEqual(["NOT_RECORDED"]);
  });

  it("والمبسّطةُ فاتورةٌ تُدفَع — تدخل كالضريبيّة", () => {
    expect(autoArchive({ ...clean, kind: "SIMPLIFIED_INVOICE" }).auto).toBe(true);
  });

  it("مورّدٌ بلا رقمٍ مسجَّل: يُتعلَّم الرقمُ بأدلّته الثلاثة", () => {
    const v = autoArchive({ ...clean, supplierVat: null, supplierByFolder: true });
    expect(v).toEqual({ auto: true, gaps: [], learnVat: "300123456700003" });
  });

  it("ولا يُتعلَّم من صورة، ولا بلا مجلّد، ولا بصيغةٍ غير صيغة الهيئة", () => {
    expect(autoArchive({ ...clean, supplierVat: null, supplierByFolder: true, textSource: "PDF_EMBEDDED" }).gaps)
      .toEqual(["NOT_TEXT", "VAT_UNKNOWN"]);
    expect(autoArchive({ ...clean, supplierVat: null, supplierByFolder: false }).gaps).toEqual(["VAT_UNKNOWN"]);
    expect(autoArchive({ ...clean, supplierVat: null, supplierByFolder: true, sellerVat: "12345" }).gaps)
      .toEqual(["VAT_UNKNOWN"]);
  });

  it("ورقمٌ يحمله مورّدٌ آخر ليس لهذا — ولا يُتعلَّم", () => {
    const v = autoArchive({ ...clean, supplierVat: null, supplierByFolder: true, vatTakenByOther: true });
    expect(v.gaps).toEqual(["VAT_MISMATCH"]);
    expect(v.learnVat).toBeNull();
  });

  it("ولكلّ شرطٍ جملةٌ تُقال", () => {
    for (const text of Object.values(GAP_TEXT)) expect(text.length).toBeGreaterThan(10);
  });
});
