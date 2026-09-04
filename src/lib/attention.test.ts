import { describe, expect, it } from "vitest";
import { buildAttention, countBySeverity, type AttentionFacts } from "./attention";

const quiet: AttentionFacts = {
  openBlockers: 0, pendingDocuments: 0,
  duplicatePayments: 0, duplicatePaymentAmountMinor: 0,
  notTaxValidCount: 0, vatAtRiskMinor: 0, vatAtRiskEvidence: [],
  unknownTaxCount: 0, unknownTaxEvidence: [],
  overdueMinor: 0, overdueSuppliers: [],
  unclassifiedBankTx: 0, unclassifiedBankAmountMinor: 0,
  suppliersMissingStatement: [], suppliersWithoutContract: [],
  invoicesWithoutLines: 0,
  priceRises: [], priceRiseAnnualMinor: 0,
};

const ids = (f: Partial<AttentionFacts>) => buildAttention({ ...quiet, ...f }).map((i) => i.id);

describe("buildAttention", () => {
  it("البيانات النظيفة لا تُنتج بنوداً", () => {
    expect(buildAttention(quiet)).toHaveLength(0);
  });

  it("كل بند يحمل خطوة ومكاناً يُعالَج فيه", () => {
    const items = buildAttention({
      ...quiet, duplicatePayments: 2, vatAtRiskMinor: 5_000, notTaxValidCount: 3,
      overdueMinor: 90_000, overdueSuppliers: [{ label: "أ" }],
      unclassifiedBankTx: 40, unclassifiedBankAmountMinor: 12_000,
      unknownTaxCount: 5, invoicesWithoutLines: 4, pendingDocuments: 1,
      suppliersMissingStatement: ["ب"], suppliersWithoutContract: ["ج"],
      priceRises: [{ label: "بن" }], priceRiseAnnualMinor: 40_000, openBlockers: 1,
    });
    expect(items.length).toBeGreaterThan(8);
    for (const i of items) {
      expect(i.action, i.id).toBeTruthy();
      expect(i.href, i.id).toMatch(/^\//);
    }
  });

  it("الحرج يسبق العالي يسبق المتوسّط", () => {
    const items = buildAttention({
      ...quiet, duplicatePayments: 1, vatAtRiskMinor: 1_000, notTaxValidCount: 1,
      unknownTaxCount: 1,
    });
    expect(items.map((i) => i.severity)).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
  });

  it("عند تساوي الدرجة يسبق الأكبر مالاً", () => {
    const items = buildAttention({
      ...quiet,
      vatAtRiskMinor: 1_000, notTaxValidCount: 1,
      overdueMinor: 500_000, overdueSuppliers: [{ label: "أ" }],
    });
    expect(items[0].id).toBe("overdue");
  });

  it("يفرّق بين «مجهولة» و«غير صالحة» — العلاجان مختلفان", () => {
    const unknown = buildAttention({ ...quiet, unknownTaxCount: 5 })[0];
    const invalid = buildAttention({ ...quiet, notTaxValidCount: 5, vatAtRiskMinor: 900 })[0];
    expect(unknown.action).toContain("اقرأ");
    expect(invalid.action).toContain("اطلب");
    expect(unknown.id).not.toBe(invalid.id);
  });

  it("الضريبة المعرّضة لا تظهر ما لم يكن لها مبلغ معلوم", () => {
    expect(ids({ notTaxValidCount: 9, vatAtRiskMinor: 0 })).not.toContain("vat-at-risk");
  });

  it("الحركات غير المصنَّفة تُوجَّه إلى صفحة المال", () => {
    const item = buildAttention({ ...quiet, unclassifiedBankTx: 20, unclassifiedBankAmountMinor: 5_000 })[0];
    expect(item.href).toBe("/money");
    expect(item.area).toBe("BANK");
  });

  it("ارتفاع الأسعار يصير حرجاً عند تجاوز ألف ريال سنوياً", () => {
    expect(buildAttention({ ...quiet, priceRiseAnnualMinor: 50_000, priceRises: [{ label: "أ" }] })[0].severity)
      .toBe("MEDIUM");
    expect(buildAttention({ ...quiet, priceRiseAnnualMinor: 150_000, priceRises: [{ label: "أ" }] })[0].severity)
      .toBe("HIGH");
  });

  it("الأدلّة تُمرَّر كما هي", () => {
    const item = buildAttention({
      ...quiet, suppliersMissingStatement: ["أوراق الزيتون", "غاناش"],
    })[0];
    expect(item.evidence.map((e) => e.label)).toEqual(["أوراق الزيتون", "غاناش"]);
  });
});

describe("countBySeverity", () => {
  it("يعدّ كل درجة", () => {
    const items = buildAttention({
      ...quiet, duplicatePayments: 1, unknownTaxCount: 1, invoicesWithoutLines: 1,
    });
    const c = countBySeverity(items);
    expect(c.CRITICAL).toBe(1);
    expect(c.MEDIUM).toBe(2);
    expect(c.HIGH).toBe(0);
  });

  it("القائمة الفارغة أصفار", () => {
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, OPPORTUNITY: 0 });
  });
});
