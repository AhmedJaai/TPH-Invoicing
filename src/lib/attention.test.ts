import { describe, expect, it } from "vitest";
import {
  buildAttention,
  countBySeverity,
  impactByKind,
  prioritize,
  type AttentionFacts,
} from "./attention";

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

describe("الأثر", () => {
  it("كل بند يحمل أثراً مصنَّفاً", () => {
    const items = buildAttention({
      ...quiet,
      duplicatePayments: 2, duplicatePaymentAmountMinor: 300_00,
      vatAtRiskMinor: 500_00, notTaxValidCount: 3,
      priceRises: [{ label: "حليب", sub: "لافا" }], priceRiseAnnualMinor: 640_000,
      openBlockers: 1,
    });
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.impact).toBeDefined();
      expect(typeof i.impact.kind).toBe("string");
    }
  });

  it("المال الذي قد يُسترد لا يُخلط بالمعرَّض للضياع", () => {
    const items = buildAttention({
      ...quiet,
      duplicatePayments: 1, duplicatePaymentAmountMinor: 1_000_00,
      vatAtRiskMinor: 2_000_00, notTaxValidCount: 4,
    });
    const dup = items.find((i) => i.id === "duplicate-payments")!;
    const vat = items.find((i) => i.id === "vat-at-risk")!;
    expect(dup.impact.kind).toBe("RECOVERABLE");
    expect(vat.impact.kind).toBe("AT_RISK");
  });

  it("المستحقّ المتأخّر مالٌ عليك لا مالٌ يضيع", () => {
    const items = buildAttention({ ...quiet, overdueMinor: 5_000_00, overdueSuppliers: [{ label: "س" }] });
    expect(items.find((i) => i.id === "overdue")!.impact.kind).toBe("OWED");
  });

  it("ما لا يُقدَّر مبلغه يبقى null لا صفراً", () => {
    const items = buildAttention({ ...quiet, pendingDocuments: 4 });
    expect(items[0].impact.amountMinor).toBeNull();
  });
});

describe("prioritize", () => {
  const noisy = () =>
    buildAttention({
      ...quiet,
      duplicatePayments: 1, duplicatePaymentAmountMinor: 800_00,
      openBlockers: 2,
      vatAtRiskMinor: 1_500_00, notTaxValidCount: 5,
      overdueMinor: 9_000_00, overdueSuppliers: [{ label: "س" }],
      unclassifiedBankTx: 3, unclassifiedBankAmountMinor: 300_00,
      pendingDocuments: 6,
      invoicesWithoutLines: 2,
    });

  it("ثلاثة في الأعلى والباقي مطويّ", () => {
    const items = noisy();
    const { top, rest } = prioritize(items);
    expect(top).toHaveLength(3);
    expect(top.length + rest.length).toBe(items.length);
  });

  it("لا يتكرّر بند بين الأعلى والباقي", () => {
    const { top, rest } = prioritize(noisy());
    const all = [...top, ...rest].map((i) => i.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("الحرج يسبق العالي مهما كان مبلغه أصغر", () => {
    const { top } = prioritize(noisy());
    expect(top[0].severity).toBe("CRITICAL");
  });

  it("داخل الشدّة الواحدة يسبق الأكبر أثراً", () => {
    const { top, rest } = prioritize(noisy(), 10);
    const all = [...top, ...rest].filter((i) => i.severity === "HIGH");
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].impact.amountMinor ?? 0).toBeGreaterThanOrEqual(all[i].impact.amountMinor ?? 0);
    }
  });

  it("الترتيب ثابت لا يتقلّب بين استدعاءين", () => {
    const a = prioritize(noisy(), 5).top.map((i) => i.id);
    const b = prioritize(noisy(), 5).top.map((i) => i.id);
    expect(a).toEqual(b);
  });

  it("لا تنكسر حين تكون البنود أقلّ من الحدّ", () => {
    const { top, rest } = prioritize(buildAttention({ ...quiet, pendingDocuments: 1 }));
    expect(top).toHaveLength(1);
    expect(rest).toEqual([]);
  });

  it("لا شيء يُنتج لا شيء", () => {
    expect(prioritize([])).toEqual({ top: [], rest: [] });
  });
});

describe("impactByKind", () => {
  it("لا تُجمع الأنواع بعضها إلى بعض", () => {
    const items = buildAttention({
      ...quiet,
      duplicatePayments: 1, duplicatePaymentAmountMinor: 1_000_00,
      vatAtRiskMinor: 2_000_00, notTaxValidCount: 2,
    });
    const by = impactByKind(items);
    expect(by.RECOVERABLE?.amountMinor).toBe(1_000_00);
    expect(by.AT_RISK?.amountMinor).toBe(2_000_00);
    expect(by.RECOVERABLE?.count).toBe(1);
  });

  it("المجهول مبلغه يُعدّ ولا يُضاف صفره إلى مبلغ", () => {
    const by = impactByKind(buildAttention({ ...quiet, pendingDocuments: 3 }));
    expect(by.BLOCKED?.count).toBe(1);
    expect(by.BLOCKED?.amountMinor).toBe(0);
  });
});
