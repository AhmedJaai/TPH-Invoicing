import { describe, expect, it } from "vitest";
import {
  buildCashFileName, buildInvoiceFileName, buildReceiptFileName, buildStatementFileName,
  parseFileName, resolveNameCollision, splitSlugAndBeneficiary,
} from "./naming";

/** الأسماء المختصرة المعروفة — لاحظ PURE-Oska الذي يحمل شرطة داخله. */
const SLUGS = [
  "OliveLeaves", "AVAL", "Zacopack", "GoldenCup", "WesternRoastery", "SardTrading",
  "CoffeeLabs", "BeCof", "Loreva", "Ganache", "KohiRoastary", "Rawnah", "AtlasRoastery",
  "AwaniAlMaida", "LavaKombucha", "SardCo", "HungryMan", "MoodCoffee", "PURE-Oska",
];

describe("تفكيك أسماء الملفات الفعلية من الأرشيف", () => {
  it("يفكّك فاتورة", () => {
    const r = parseFileName("2026-08-17_OliveLeaves_Invoice_260302_SAR130.00.pdf", SLUGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      kind: "INVOICE", date: "2026-08-17", slug: "OliveLeaves",
      invoiceNumber: "260302", amountMinor: 13_000, extension: "pdf",
    });
  });

  it("يفكّك كشف حساب بمبلغ من خمس منازل", () => {
    const r = parseFileName("2026-08-31_OliveLeaves_Statement_SAR17572.00.pdf", SLUGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ kind: "STATEMENT", slug: "OliveLeaves", amountMinor: 1_757_200 });
  });

  it("يفكّك إيصالاً بلا اسم مستفيد", () => {
    const r = parseFileName("2026-09-02_Receipt_OliveLeaves_SAR3760.00.pdf", SLUGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ kind: "RECEIPT", slug: "OliveLeaves", amountMinor: 376_000 });
    expect(r.value.beneficiary).toBeUndefined();
  });

  it("يفصل اسم المستفيد البنكي عن اسم المورد", () => {
    const r = parseFileName("2026-09-02_Receipt_Loreva-MaqamAlThiqa_SAR4151.50.pdf", SLUGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      kind: "RECEIPT", slug: "Loreva", beneficiary: "MaqamAlThiqa", amountMinor: 415_150,
    });
  });

  it("يفكّك إيصالاً نقدياً بوصف عربي ويحفظ الامتداد الأصلي", () => {
    const r = parseFileName("2026-09-01_Cash_ثلج وأكياس_SAR50.00.jpg", SLUGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ kind: "CASH", description: "ثلج وأكياس", extension: "jpg" });
  });
});

describe("الحالة الشائكة: slug يحمل شرطة", () => {
  it("لا يكسر PURE-Oska عند أول شرطة", () => {
    expect(splitSlugAndBeneficiary("PURE-Oska", SLUGS)).toEqual({ slug: "PURE-Oska" });
  });

  it("يفصل المستفيد بعد slug يحمل شرطة", () => {
    expect(splitSlugAndBeneficiary("PURE-Oska-AlRajhi", SLUGS))
      .toEqual({ slug: "PURE-Oska", beneficiary: "AlRajhi" });
  });

  it("يختار أطول slug مطابق لا أقصره", () => {
    expect(splitSlugAndBeneficiary("SardTrading-Someone", ["Sard", "SardTrading"]))
      .toEqual({ slug: "SardTrading", beneficiary: "Someone" });
  });
});

describe("رفض الأسماء المخالفة", () => {
  it("يرفض مبلغاً بلا منزلتين عشريتين", () => {
    const r = parseFileName("2026-08-17_OliveLeaves_Invoice_260302_SAR410.pdf", SLUGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("منزلتين");
  });

  it("يتجاهل ملفات الملاحظات", () => {
    expect(parseFileName("NOTES.txt", SLUGS).ok).toBe(false);
  });

  it("يرفض تاريخاً غير موجود", () => {
    const r = parseFileName("2026-02-30_OliveLeaves_Invoice_1_SAR10.00.pdf", SLUGS);
    expect(r.ok).toBe(false);
  });

  it("يرفض بطاقة معلومات المورد", () => {
    expect(parseFileName("_معلومات المورد.txt", SLUGS).ok).toBe(false);
  });
});

describe("تكرار الاسم", () => {
  it("يقرأ رقم النسخة", () => {
    const r = parseFileName("2026-08-17_OliveLeaves_Invoice_260302_SAR130.00 (2).pdf", SLUGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.duplicateIndex).toBe(2);
    expect(r.value.invoiceNumber).toBe("260302");
  });

  it("يضيف نسخة جديدة ولا يستبدل ملفاً موجوداً", () => {
    const existing = ["a_SAR1.00.pdf"];
    expect(resolveNameCollision("a_SAR1.00.pdf", existing)).toBe("a_SAR1.00 (2).pdf");
    expect(resolveNameCollision("a_SAR1.00.pdf", [...existing, "a_SAR1.00 (2).pdf"]))
      .toBe("a_SAR1.00 (3).pdf");
  });
});

describe("البناء والتفكيك متعاكسان", () => {
  it("الفاتورة", () => {
    const name = buildInvoiceFileName({
      date: "2026-09-04", slug: "OliveLeaves", invoiceNumber: "260340", amountMinor: 41_000,
    });
    expect(name).toBe("2026-09-04_OliveLeaves_Invoice_260340_SAR410.00.pdf");
    const r = parseFileName(name, SLUGS);
    expect(r.ok && r.value.amountMinor).toBe(41_000);
  });

  it("يفرض منزلتين عشريتين دائماً", () => {
    expect(buildStatementFileName({ date: "2026-08-31", slug: "AVAL", amountMinor: 41_000 }))
      .toContain("SAR410.00");
    expect(buildStatementFileName({ date: "2026-08-31", slug: "AVAL", amountMinor: 41_050 }))
      .toContain("SAR410.50");
  });

  it("الإيصال بمستفيد", () => {
    const name = buildReceiptFileName({
      date: "2026-09-02", slug: "Ganache", beneficiary: "Khashoggi", amountMinor: 543_260,
    });
    expect(name).toBe("2026-09-02_Receipt_Ganache-Khashoggi_SAR5432.60.pdf");
    const r = parseFileName(name, SLUGS);
    expect(r.ok && r.value.beneficiary).toBe("Khashoggi");
  });

  it("النقدي يحتفظ بامتداد الصورة", () => {
    expect(buildCashFileName({ date: "2026-09-01", description: "ثلج", amountMinor: 5_000 }))
      .toBe("2026-09-01_Cash_ثلج_SAR50.00.jpg");
  });
});


describe("صيغ حقيقية من الأرشيف لم يتوقّعها المفكّك أولاً", () => {
  it("كشف بوصف فترة قبل المبلغ", () => {
    const r = parseFileName("2026-05-31_Ganache-AGK_Statement_May_SAR6371.00.pdf", ["Ganache-AGK"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("STATEMENT");
    expect(r.value.slug).toBe("Ganache-AGK");
    expect(r.value.periodLabel).toBe("May");
    expect(r.value.amountMinor).toBe(637_100);
  });

  it("كشف بوصف بدل المبلغ", () => {
    const r = parseFileName("2026-07-31_OliveLeaves_Statement_to-31-07.pdf", SLUGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.amountMinor).toBeUndefined();
    expect(r.value.periodLabel).toBe("to-31-07");
  });

  it("فاتورة مبدئية تُميَّز عن الفاتورة", () => {
    const r = parseFileName("2026-05-17_GoldenCup_ProformaInvoice_INV263287_SAR13506.75.pdf", SLUGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("PROFORMA");
    expect(r.value.invoiceNumber).toBe("INV263287");
  });

  it("فاتورة بلا رقم", () => {
    const r = parseFileName("2026-05-21_LavaKombucha_Invoice_SAR405.00.pdf", SLUGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("INVOICE");
    expect(r.value.invoiceNumber).toBeUndefined();
    expect(r.value.amountMinor).toBe(40_500);
  });

  it("اسم يحمل الشهر بلا يوم يُعلَّم", () => {
    const r = parseFileName("2026-05_HungryManBakery_Invoices_INVA-02527_SAR240.00.pdf", []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.date).toBe("2026-05-01");
    expect(r.value.monthOnly).toBe(true);
  });

  it("الدفتر يُقرأ ككشف", () => {
    const r = parseFileName("2026-05-31_HungryManBakery_Ledger_May_SAR240.00.pdf", []);
    expect(r.ok && r.value.kind).toBe("LEDGER");
  });

  it("الفاتورة الصادرة تُميَّز عن الواردة", () => {
    const r = parseFileName("2026-07-01_SalesInvoice_SabeaJar_S00011_SAR1100.00.pdf", []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("SALES_INVOICE");
  });

  it("الفاتورة الممسوحة تُقرأ كفاتورة", () => {
    const r = parseFileName("2026-06-13_PURE-Oska_Invoice-scan_SAR396.75.pdf", ["PURE-Oska"]);
    expect(r.ok && r.value.kind).toBe("INVOICE");
  });
});

describe("صيغ نوع ظهرت في الأرشيف الفعلي", () => {
  it("يفهم TaxInvoice كفاتورة — كانت تسقط من الترحيل بصمت", () => {
    const r = parseFileName(
      "2026-08-18_SardTrading_TaxInvoice_124001345_SAR11600.00.pdf",
      ["SardTrading"],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("INVOICE");
    expect(r.value.slug).toBe("SardTrading");
    expect(r.value.invoiceNumber).toBe("124001345");
    expect(r.value.amountMinor).toBe(1_160_000);
    expect(r.value.date).toBe("2026-08-18");
  });
});
