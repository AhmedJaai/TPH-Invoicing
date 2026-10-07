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

  it("فاتورةٌ بلا سطر ضريبة: البنودُ تساوي الإجماليّ — أوراق الزيتون", () => {
    const olive = { ...clean, textSource: null, subtotalMinor: null, vatMinor: null, totalMinor: 26_000, linesTotalMinor: 26_000 };
    expect(autoArchive(olive).auto).toBe(true);
    expect(autoArchive({ ...olive, linesTotalMinor: 25_000 }).gaps).toEqual(["ARITHMETIC", "UNVERIFIED_IMAGE"]);
  });

  it("والبنودُ قبل الضريبة + الضريبة = الإجمالي", () => {
    expect(autoArchive({ ...clean, subtotalMinor: null, linesTotalMinor: 40_000 }).auto).toBe(true);
  });

  it("الكشفُ لا يُسأل عن رقم فاتورة ولا حساب — مورّدُه وقيدُه يكفيان", () => {
    const st = { ...clean, kind: "STATEMENT", invoiceNumber: null, subtotalMinor: null, vatMinor: null, totalMinor: null };
    expect(autoArchive({ ...st, statementRecorded: true }).auto).toBe(true);
    expect(autoArchive({ ...st, statementRecorded: false }).gaps).toEqual(["NOT_RECORDED"]);
    expect(autoArchive({ ...st, supplierKnown: false }).gaps).toEqual(["SUPPLIER_UNKNOWN"]);
  });

  it("ولكلّ شرطٍ جملةٌ تُقال", () => {
    for (const text of Object.values(GAP_TEXT)) expect(text.length).toBeGreaterThan(10);
  });
});

describe("الأرشفةُ الآليّة والخصمُ بعد الضريبة", () => {
  /* ٤٠٠ + ٦٠ − ١٠ = ٤٥٠ */
  const discounted = { ...clean, totalMinor: 45_000 };
  it("الحسابُ يستقيم بالخصم المقيَّد فيدخل", () => {
    expect(autoArchive({ ...discounted, discountMinor: 1_000 }).auto).toBe(true);
  });
  it("وبلا خصمٍ يبقى «الحسابُ لا يستقيم»", () => {
    expect(autoArchive(discounted).gaps).toContain("ARITHMETIC");
  });
  it("ورسومُ التوصيل المقيَّدة تُقيم الحساب كذلك", () => {
    expect(autoArchive({ ...clean, totalMinor: 48_500, chargesMinor: 2_500 }).auto).toBe(true);
  });
});

describe("رمز الفاتورة الضريبيّ (QR) — شاهدٌ من خارج النموذج", () => {
  /* صورةٌ ممسوحة بلا شاهد: ضريبتُها ليست ١٥٪ ولا بنود ولا رقم في الاسم */
  const scanned: AutoArchiveFacts = {
    kind: "TAX_INVOICE", invoiceRecorded: true, textSource: "PDF_EMBEDDED", supplierKnown: true,
    subtotalMinor: 100_000, vatMinor: 9_000, totalMinor: 109_000, invoiceNumber: "77", fileName: "scan.pdf",
  };

  it("بلا رمزٍ تنتظر مراجعة", () => {
    expect(autoArchive(scanned)).toEqual({ auto: false, gaps: ["UNVERIFIED_IMAGE"] });
  });

  it("رمزٌ يطابق الإجماليّ والضريبة بالهللة يُدخلها وحدها", () => {
    expect(autoArchive({ ...scanned, qrTotalMinor: 109_000, qrVatMinor: 9_000 })).toEqual({ auto: true, gaps: [] });
  });

  it("رمزٌ بإجماليٍّ وحده (ضريبتُه لم تُقرأ) يكفي شاهداً — المجهول لا يُعدّ خلافاً", () => {
    expect(autoArchive({ ...scanned, qrTotalMinor: 109_000, qrVatMinor: null }).auto).toBe(true);
  });

  it("فرقُ هللاتٍ داخل الريال: لا شاهدٌ ولا خلاف", () => {
    expect(autoArchive({ ...scanned, qrTotalMinor: 109_040, qrVatMinor: 9_000 })).toEqual({ auto: false, gaps: ["UNVERIFIED_IMAGE"] });
  });

  it("رقمٌ مقلوبٌ يستقيم جمعُه: الرمز يكشفه", () => {
    /* قُرئ ١٬٠٩٠ والمطبوع ١٬٩٠٠ — الصافي والإجماليّ انقلبا معاً فاستقام الحساب */
    const v = autoArchive({ ...scanned, qrTotalMinor: 190_000, qrVatMinor: 9_000 });
    expect(v.auto).toBe(false);
    expect(v.gaps).toContain("QR_MISMATCH");
  });

  it("والنصّ المكتوب لا يُعفى: رمزٌ يخالفه يمنع الدخول الآليّ", () => {
    const text: AutoArchiveFacts = { ...scanned, textSource: "TEXT" };
    expect(autoArchive(text).auto).toBe(true);
    expect(autoArchive({ ...text, qrTotalMinor: 119_000 })).toEqual({ auto: false, gaps: ["QR_MISMATCH"] });
    expect(autoArchive({ ...text, qrTotalMinor: 109_000, qrVatMinor: 14_000 }).gaps).toEqual(["QR_MISMATCH"]);
  });

  it("خلافٌ في رقم البائع أو شهر التاريخ يمنع ولو طابق المبلغ", () => {
    expect(autoArchive({ ...scanned, qrTotalMinor: 109_000, qrVatMinor: 9_000, qrOtherConflict: true }).gaps).toEqual(["QR_MISMATCH"]);
  });

  it("مبلغٌ بدّله النموذج عند إعادة السؤال لا يدخل إلّا برمزٍ يصدّقه", () => {
    const text: AutoArchiveFacts = { ...scanned, textSource: "TEXT", reaskChangedMoney: true };
    expect(autoArchive(text)).toEqual({ auto: false, gaps: ["REASK_CHANGED"] });
    expect(autoArchive({ ...text, qrTotalMinor: 109_000, qrVatMinor: 9_000 }).auto).toBe(true);
  });
});
