import { describe, expect, it } from "vitest";
import { emptyEvidence, evidenceWarnings, parseEvidence, qrArchiveFacts, reconcileWithQr } from "./evidence";
import type { ExtractionResult } from "./schema";
import type { ZatcaQrFacts } from "./zatca-tlv";

const COMPANY_VAT = "310007971600003";

function invoice(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    documentKind: "TAX_INVOICE",
    supplierNameAr: "مؤسسة أوراق الزيتون", supplierNameEn: "",
    sellerVatNumber: "310122393500003", sellerCrNumber: "",
    buyerNameAr: "", buyerVatNumber: COMPANY_VAT,
    invoiceNumber: "260391", invoiceDate: "2026-09-13",
    subtotalAmount: "1000.00", vatAmount: "150.00", discountAmount: "", chargesAmount: "", totalAmount: "1150.00",
    beneficiaryName: "", lines: [], openingBalance: "", closingBalance: "", statementLines: [],
    confidence: { documentKind: 1, supplierName: 1, invoiceNumber: 1, invoiceDate: 1, amounts: 1, vatNumbers: 1 },
    notes: "",
    ...over,
  };
}

function qr(over: Partial<ZatcaQrFacts> = {}): ZatcaQrFacts {
  return {
    sellerName: "مؤسسة أوراق الزيتون", sellerVatNumber: "310122393500003", sellerVatRaw: "310122393500003",
    timestampRaw: "2026-09-13T15:13:00Z", date: "2026-09-13", totalMinor: 115000, vatMinor: 15000,
    phase2: false, tags: [1, 2, 3, 4, 5],
    ...over,
  };
}

describe("reconcileWithQr — الرمز يسدّ فراغاً ولا يكتب فوق قراءة", () => {
  it("قراءةٌ يطابقها الرمز: أربعة اتّفاقات ولا تغيير", () => {
    const r = reconcileWithQr(invoice(), qr(), COMPANY_VAT);
    expect(r.agreements).toEqual(["total", "vat", "sellerVat", "date"]);
    expect(r.disagreements).toEqual([]);
    expect(r.provenance).toEqual({});
    expect(r.value).toEqual(invoice());
  });

  it("ما سكت عنه النموذج يُسدّ من الرمز ويُعلَّم مصدرُه", () => {
    const r = reconcileWithQr(
      invoice({ totalAmount: "", vatAmount: "", sellerVatNumber: "", invoiceDate: "", supplierNameAr: "" }),
      qr(), COMPANY_VAT,
    );
    expect(r.value).toMatchObject({
      totalAmount: "1150.00", vatAmount: "150.00", sellerVatNumber: "310122393500003",
      invoiceDate: "2026-09-13", supplierNameAr: "مؤسسة أوراق الزيتون",
    });
    expect(r.provenance).toEqual({
      totalAmount: "QR", vatAmount: "QR", sellerVatNumber: "QR", invoiceDate: "QR", supplierNameAr: "QR",
    });
  });

  it("المجهول في الرمز لا يسدّ شيئاً — ولا يُكتب صفر", () => {
    const r = reconcileWithQr(invoice({ totalAmount: "", vatAmount: "" }), qr({ totalMinor: null, vatMinor: null }), COMPANY_VAT);
    expect(r.value.totalAmount).toBe("");
    expect(r.value.vatAmount).toBe("");
  });

  it("ضريبةٌ صفرٌ مكتوبةٌ في الرمز صفرٌ حقيقيّ يُسدّ به", () => {
    const r = reconcileWithQr(invoice({ vatAmount: "", totalAmount: "260.00" }), qr({ totalMinor: 26000, vatMinor: 0 }), COMPANY_VAT);
    expect(r.value.vatAmount).toBe("0.00");
  });

  it("إجماليٌّ يخالف الرمز بأكثر من ريال: خلافٌ مانع، والمقروء لا يُمسّ", () => {
    const r = reconcileWithQr(invoice({ totalAmount: "1510.00" }), qr(), COMPANY_VAT);
    expect(r.value.totalAmount).toBe("1510.00");
    expect(r.disagreements).toEqual([{ field: "total", read: "1510.00", qr: "1150.00", blocking: true }]);
  });

  it("فرقُ هللاتٍ داخل الريال يُعرَض ولا يمنع", () => {
    const r = reconcileWithQr(invoice({ totalAmount: "1150.40" }), qr(), COMPANY_VAT);
    expect(r.disagreements).toEqual([{ field: "total", read: "1150.40", qr: "1150.00", blocking: false }]);
  });

  it("النموذج بدّل الطرفين فقرأ رقمَنا بائعاً: يُؤخذ رقم الرمز", () => {
    const r = reconcileWithQr(invoice({ sellerVatNumber: COMPANY_VAT }), qr(), COMPANY_VAT);
    expect(r.value.sellerVatNumber).toBe("310122393500003");
    expect(r.provenance.sellerVatNumber).toBe("QR");
  });

  it("رقمُ بائعٍ ناقصُ الشكل يُسدّ، وصحيحُ الشكل يخالف الرمز خلافٌ مانع", () => {
    expect(reconcileWithQr(invoice({ sellerVatNumber: "31012239350000" }), qr(), COMPANY_VAT).value.sellerVatNumber)
      .toBe("310122393500003");
    const r = reconcileWithQr(invoice({ sellerVatNumber: "300999888700003" }), qr(), COMPANY_VAT);
    expect(r.value.sellerVatNumber).toBe("300999888700003");
    expect(r.disagreements).toEqual([{ field: "sellerVat", read: "300999888700003", qr: "310122393500003", blocking: true }]);
  });

  it("رمزٌ يحمل رقمَنا نحن بائعاً لا يُؤخذ منه رقم", () => {
    const r = reconcileWithQr(invoice({ sellerVatNumber: "" }), qr({ sellerVatNumber: COMPANY_VAT }), COMPANY_VAT);
    expect(r.value.sellerVatNumber).toBe("");
  });

  it("يومٌ وشهرٌ مقلوبان يحسمهما الرمز", () => {
    const r = reconcileWithQr(invoice({ invoiceDate: "2026-04-03" }), qr({ date: "2026-03-04" }), COMPANY_VAT);
    expect(r.value.invoiceDate).toBe("2026-03-04");
    expect(r.provenance.invoiceDate).toBe("QR");
    expect(r.disagreements).toEqual([]);
  });

  it("تاريخٌ في شهرٍ آخر خلافٌ مانع، وفي الشهر نفسه يُعرَض", () => {
    expect(reconcileWithQr(invoice({ invoiceDate: "2026-08-13" }), qr(), COMPANY_VAT).disagreements)
      .toEqual([{ field: "date", read: "2026-08-13", qr: "2026-09-13", blocking: true }]);
    expect(reconcileWithQr(invoice({ invoiceDate: "2026-09-12" }), qr(), COMPANY_VAT).disagreements)
      .toEqual([{ field: "date", read: "2026-09-12", qr: "2026-09-13", blocking: false }]);
  });

  it("الكشف والإيصال لا يُمسّان برمزٍ وُجد في صفحتهما", () => {
    const statement = invoice({ documentKind: "STATEMENT", totalAmount: "", invoiceDate: "" });
    const r = reconcileWithQr(statement, qr(), COMPANY_VAT);
    expect(r.value).toEqual(statement);
    expect(r.agreements).toEqual([]);
  });
});

describe("qrArchiveFacts · parseEvidence · evidenceWarnings", () => {
  it("بلا دليلٍ محفوظ: كلُّه مجهول ولا شيء يمنع", () => {
    expect(qrArchiveFacts(null)).toEqual({ qrTotalMinor: null, qrVatMinor: null, qrOtherConflict: false, reaskChangedMoney: false });
    expect(parseEvidence(null)).toBeNull();
    expect(parseEvidence({ qr: "junk" })).toBeNull();
    expect(evidenceWarnings(null)).toEqual([]);
  });

  it("يحمل مبلغَي الرمز والخلافَ المانع في غير المبلغ وتبدّلَ المال", () => {
    const e = emptyEvidence();
    e.qr = { status: "FOUND", facts: qr(), page: 1 };
    e.disagreements = [{ field: "date", read: "2026-08-13", qr: "2026-09-13", blocking: true }];
    e.reaskChanged = ["totalAmount"];
    expect(qrArchiveFacts(e)).toEqual({ qrTotalMinor: 115000, qrVatMinor: 15000, qrOtherConflict: true, reaskChangedMoney: true });
    /* ويعود كما هو بعد الحفظ والقراءة */
    expect(parseEvidence(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });

  it("يقول لمن يراجع ما يستحقّ نظره", () => {
    const e = emptyEvidence();
    e.disagreements = [{ field: "total", read: "1510.00", qr: "1150.00", blocking: true }];
    e.unresolvedConflicts = ["البند 3: 2 × 45.00 لا يساوي 95.00"];
    e.pages = { read: 3, total: 5 };
    const w = evidenceWarnings(e);
    expect(w).toHaveLength(3);
    expect(w[0]).toContain("1150.00");
    expect(w[2]).toContain("3 من 5");
  });
});
