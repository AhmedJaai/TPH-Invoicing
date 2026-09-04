import { describe, expect, it } from "vitest";
import { runPipeline } from "./pipeline";
import type { ExtractionResult } from "./schema";
import type { SupplierRecord } from "@/lib/supplier-match";
import { ISSUE } from "@/lib/issue-codes";
import { parseFileName } from "@/lib/naming";

const COMPANY_VAT = "310007971600003";

const olive: SupplierRecord = {
  id: "1", slug: "OliveLeaves", nameAr: "أوراق الزيتون", nameEn: "Olive Leaves",
  driveFolderName: "Olive Leaves", vatNumber: "310111111100003",
  issuesInvoices: true, contractOnFile: false, aliases: [],
};

const oska: SupplierRecord = {
  ...olive, id: "2", slug: "PURE-Oska", nameAr: "أوسكا", nameEn: "PURE Oska",
  driveFolderName: "PURE - Oska Water", vatNumber: null, issuesInvoices: false,
};

const base: ExtractionResult = {
  documentKind: "TAX_INVOICE",
  supplierNameAr: "أوراق الزيتون", supplierNameEn: "Olive Leaves",
  sellerVatNumber: "310111111100003", sellerCrNumber: "",
  buyerNameAr: "ذا بوبليك هاوس", buyerVatNumber: COMPANY_VAT,
  invoiceNumber: "260302", invoiceDate: "2026-08-17",
  subtotalAmount: "113.04", vatAmount: "16.96", totalAmount: "130.00",
  beneficiaryName: "", lines: [],
  openingBalance: "", closingBalance: "", statementLines: [],
  confidence: { documentKind: 0.99, supplierName: 0.98, invoiceNumber: 0.97, invoiceDate: 0.99, amounts: 0.98, vatNumbers: 0.96 },
  notes: "",
};

const run = (x: Partial<ExtractionResult>, opts: Partial<Parameters<typeof runPipeline>[0]> = {}) =>
  runPipeline({
    extraction: { ...base, ...x },
    match: { supplier: olive, method: "VAT", confidence: 1, candidates: [] },
    companyVat: COMPANY_VAT,
    originalFileName: "IMG_20260817_whatsapp.pdf",
    ...opts,
  });

const codes = (r: ReturnType<typeof runPipeline>) => r.findings.map((f) => f.code);

describe("فاتورة ضريبية سليمة وصلت باسم عشوائي", () => {
  const r = run({});

  it("يعيد تسميتها بالصيغة المعتمدة", () => {
    expect(r.proposedFileName).toBe("2026-08-17_OliveLeaves_Invoice_260302_SAR130.00.pdf");
  });

  it("يضعها في مجلد شهر تاريخ الفاتورة داخل مجلد موردها", () => {
    expect(r.proposedFolderPath).toBe("ACCOUNTS / 2026 / 2026-08 / Olive Leaves");
  });

  it("صالحة لخصم المدخلات ويسمح بأرشفتها", () => {
    expect(r.taxStatus).toBe("VALID");
    expect(r.inputVatStatus).toBe("ELIGIBLE");
    expect(r.canArchive).toBe(true);
    expect(r.findings).toHaveLength(0);
  });
});

describe("عرض السعر", () => {
  it("يُصنَّف ولا يُسمح بقيده", () => {
    const r = run({ documentKind: "QUOTATION" });
    expect(codes(r)).toContain(ISSUE.NOT_A_TAX_INVOICE);
    expect(r.canArchive).toBe(false);
  });
});

describe("الفاتورة المبسطة", () => {
  it("تنبّه لفقد خصم المدخلات لكنها تُؤرشف", () => {
    const r = run({ documentKind: "SIMPLIFIED_INVOICE", buyerVatNumber: "" });
    expect(codes(r)).toContain(ISSUE.MISSING_BUYER_VAT);
    expect(r.inputVatStatus).not.toBe("ELIGIBLE");
    expect(r.canArchive).toBe(true);
  });
});

describe("رقم ضريبي لمنشأة أخرى", () => {
  it("يمنع الأرشفة", () => {
    const r = run({ buyerVatNumber: "310999999900003" });
    expect(codes(r)).toContain(ISSUE.BUYER_VAT_MISMATCH);
    expect(r.canArchive).toBe(false);
  });
});

describe("التكرار", () => {
  it("يمنع نفس رقم الفاتورة لنفس المورد", () => {
    const r = run({}, { existingInvoiceNumbers: ["260302"] });
    expect(codes(r)).toContain(ISSUE.DUPLICATE_INVOICE);
    expect(r.canArchive).toBe(false);
  });

  it("يمنع رفع نفس الملف مرة ثانية", () => {
    const r = run({}, { fileAlreadyUploaded: true });
    expect(codes(r)).toContain(ISSUE.DUPLICATE_FILE);
    expect(r.canArchive).toBe(false);
  });
});

describe("إيصال السداد", () => {
  const r = run({
    documentKind: "RECEIPT", invoiceNumber: "", invoiceDate: "2026-09-02",
    totalAmount: "4151.50", subtotalAmount: "", vatAmount: "",
    supplierNameAr: "لوريفا", beneficiaryName: "مقام الثقة",
  });

  it("يذهب إلى مجلد إيصالات السداد في شهر الفواتير لا شهر التحويل", () => {
    expect(r.periodMonth).toBe("2026-08");
    expect(r.proposedFolderPath).toBe("ACCOUNTS / 2026 / 2026-08 / _إيصالات السداد");
  });

  it("يحمل اسم المستفيد في اسم الملف ولو كان عربياً", () => {
    expect(r.proposedFileName).toBe("2026-09-02_Receipt_OliveLeaves-مقام الثقة_SAR4151.50.pdf");
  });

  it("يفكّك الاسم الناتج ويستعيد المورد والمستفيد", () => {
    const parsed = parseFileName(r.proposedFileName!, ["OliveLeaves"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.slug).toBe("OliveLeaves");
    expect(parsed.value.beneficiary).toBe("مقام الثقة");
  });

  it("يحوّل اسم المستفيد اللاتيني إلى صيغة مدمجة", () => {
    const latin = run({
      documentKind: "RECEIPT", invoiceNumber: "", invoiceDate: "2026-09-02",
      totalAmount: "5432.60", subtotalAmount: "", vatAmount: "",
      beneficiaryName: "maqam al thiqa",
    });
    expect(latin.proposedFileName).toContain("OliveLeaves-MaqamAlThiqa");
  });

  it("لا يُطبَّق عليه الفحص الضريبي للفواتير", () => {
    expect(codes(r)).not.toContain(ISSUE.MISSING_INVOICE_NUMBER);
  });
});

describe("كشف الحساب", () => {
  it("يُسمّى Statement ويبقى مع مورده", () => {
    const r = run({ documentKind: "STATEMENT", invoiceNumber: "", invoiceDate: "2026-08-31", totalAmount: "17572.00" });
    expect(r.proposedFileName).toBe("2026-08-31_OliveLeaves_Statement_SAR17572.00.pdf");
    expect(r.proposedFolderPath).toBe("ACCOUNTS / 2026 / 2026-08 / Olive Leaves");
  });
});

describe("الحقول الناقصة تمنع الأرشفة بدل التخمين", () => {
  it("بلا تاريخ", () => {
    const r = run({ invoiceDate: "" });
    expect(r.canArchive).toBe(false);
    expect(r.proposedFileName).toBeUndefined();
  });

  it("بلا مبلغ", () => {
    const r = run({ totalAmount: "" });
    expect(r.canArchive).toBe(false);
  });
});

describe("مورد غير معروف", () => {
  it("يمنع الأرشفة ويطلب إنشاء المورد", () => {
    const r = runPipeline({
      extraction: base, companyVat: COMPANY_VAT, originalFileName: "x.pdf",
      match: { method: "NONE", confidence: 0, candidates: [] },
    });
    expect(r.canArchive).toBe(false);
    expect(r.supplier).toBeUndefined();
  });
});

describe("مورد بلا فواتير", () => {
  it("ينبّه لغياب عقد التوريد", () => {
    const r = runPipeline({
      extraction: { ...base, documentKind: "SIMPLIFIED_INVOICE", buyerVatNumber: "" },
      match: { supplier: oska, method: "NAME", confidence: 0.9, candidates: [] },
      companyVat: COMPANY_VAT, originalFileName: "x.pdf",
    });
    expect(codes(r)).toContain(ISSUE.SUPPLIER_WITHOUT_CONTRACT);
  });
});

describe("الأصل الثابت", () => {
  it("ينبّه فوق ٣٬٠٠٠ ريال ولا يمنع الأرشفة", () => {
    const r = run({ subtotalAmount: "3500.00", vatAmount: "525.00", totalAmount: "4025.00" });
    expect(r.isFixedAsset).toBe(true);
    expect(codes(r)).toContain(ISSUE.POSSIBLE_FIXED_ASSET);
    expect(r.canArchive).toBe(true);
  });
});

describe("ثقة الاستخراج المنخفضة", () => {
  it("تُجمع الحقول للمراجعة البشرية", () => {
    const r = run({ confidence: { ...base.confidence, amounts: 0.4, invoiceDate: 0.5 } });
    expect(r.lowConfidenceFields).toEqual(expect.arrayContaining(["المبالغ", "التاريخ"]));
    expect(codes(r)).toContain(ISSUE.LOW_CONFIDENCE_FIELD);
  });
});

describe("الصورة تحتفظ بامتدادها", () => {
  it("لا تتحول إلى pdf", () => {
    const r = runPipeline({
      extraction: base,
      match: { supplier: olive, method: "VAT", confidence: 1, candidates: [] },
      companyVat: COMPANY_VAT, originalFileName: "IMG_4821.jpg",
    });
    expect(r.proposedFileName?.endsWith(".jpg")).toBe(true);
  });
});
