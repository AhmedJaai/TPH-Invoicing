import { describe, expect, it } from "vitest";
import { settlePreVatDiscount } from "./discount";
import type { ExtractionResult } from "./schema";

const base: ExtractionResult = {
  documentKind: "SIMPLIFIED_INVOICE",
  supplierNameAr: "مود القهوة", supplierNameEn: "", sellerVatNumber: "311319035500003", sellerCrNumber: "",
  buyerNameAr: "", buyerVatNumber: "",
  invoiceNumber: "74389", invoiceDate: "2026-09-30",
  subtotalAmount: "209.00", vatAmount: "26.65", discountAmount: "31.35", chargesAmount: "", totalAmount: "204.30",
  beneficiaryName: "", lines: [], openingBalance: "", closingBalance: "", statementLines: [],
  confidence: { documentKind: 0.9, supplierName: 0.9, invoiceNumber: 0.9, invoiceDate: 0.9, amounts: 0.9, vatNumbers: 0.9 },
  notes: "",
};

describe("الخصمُ قبل الضريبة", () => {
  it("إيصالُ مود القهوة: الخاضعُ للضريبة بعد الخصم ١٧٧٫٦٥ لا ٢٠٩", () => {
    const r = settlePreVatDiscount(base);
    expect(r.value.subtotalAmount).toBe("177.65");
    expect(r.discount).toEqual({ grossMinor: 209_00, discountMinor: 31_35 });
  });

  it("يُعاد تشغيلُه فلا يتغيّر شيء — ويبقى تفصيلُ الخصم للعرض", () => {
    const once = settlePreVatDiscount(base).value;
    const twice = settlePreVatDiscount(once);
    expect(twice.value.subtotalAmount).toBe("177.65");
    expect(twice.discount).toEqual({ grossMinor: 209_00, discountMinor: 31_35 });
  });

  it("الخصمُ بعد الضريبة يبقى كما هو: الضريبةُ ١٥٪ من المجموع كلِّه", () => {
    const r = settlePreVatDiscount({ ...base, subtotalAmount: "100.00", vatAmount: "15.00", discountAmount: "10.00", totalAmount: "105.00" });
    expect(r.value.subtotalAmount).toBe("100.00");
    expect(r.discount).toBeNull();
  });

  it("وفاتورةٌ بلا ضريبة: الخصمُ يُنقص الكلفة", () => {
    const r = settlePreVatDiscount({ ...base, vatAmount: "0.00", totalAmount: "177.65" });
    expect(r.value.subtotalAmount).toBe("177.65");
  });

  it("ولا خصمَ أو أرقامٌ لا تستقيم: لا يُمسّ شيء", () => {
    expect(settlePreVatDiscount({ ...base, discountAmount: "" }).value.subtotalAmount).toBe("209.00");
    expect(settlePreVatDiscount({ ...base, totalAmount: "300.00" }).value.subtotalAmount).toBe("209.00");
  });
});

describe("الخصمُ يُكتب أو يُصحَّح في بطاقة الرفع", async () => {
  const { applyEdits } = await import("./apply-edits");
  const { runPipeline } = await import("./pipeline");
  const pipe = (x: ExtractionResult) => runPipeline({
    extraction: x, companyVat: "310007971600003", originalFileName: "r.jpg",
    match: { supplier: undefined, method: "NONE", confidence: 0, candidates: [] },
  });

  it("غاب الخصمُ عن القراءة فكُتب: الوعاءُ بعده", () => {
    const missed = { ...base, discountAmount: "" };
    const edited = applyEdits(missed, { discount: "31.35" });
    expect(edited.subtotalAmount).toBe("177.65");
    expect(pipe(edited).subtotalMinor).toBe(177_65);
    expect(pipe(edited).preVatDiscount).toEqual({ grossMinor: 209_00, discountMinor: 31_35 });
  });

  it("وصُحِّح: يُخصم من المجموع قبل الخصم لا من الوعاء — لا مرّتين", () => {
    expect(applyEdits(base, { discount: "40.00" }).subtotalAmount).toBe("169.00");
    const alreadyNet = settlePreVatDiscount(base).value;
    expect(applyEdits(alreadyNet, { discount: "40.00" }).subtotalAmount).toBe("169.00");
  });

  it("وأُزيل بصفر: الوعاءُ المجموعُ كلُّه", () => {
    const r = applyEdits(base, { discount: "0" });
    expect(r.subtotalAmount).toBe("209.00");
    expect(r.discountAmount).toBe("");
  });

  it("والقراءةُ نفسُها في المسار: إيصالُ مود القهوة كما حُفظ يُعرض بوعائه الصحيح", () => {
    const r = pipe(base);
    expect(r.subtotalMinor).toBe(177_65);
    expect(r.preVatDiscount).toEqual({ grossMinor: 209_00, discountMinor: 31_35 });
  });
});
