import { describe, expect, it } from "vitest";
import {
  buildSupplierHealth,
  overallGrade,
  scoreDocuments,
  scorePricing,
  scoreStatements,
  scoreVat,
  type SupplierFacts,
} from "./supplier-health";

const base: SupplierFacts = {
  invoiceCount: 10,
  taxValidCount: 10,
  taxInvalidCount: 0,
  taxUnknownCount: 0,
  issuesInvoices: true,
  contractOnFile: false,
  hasVatNumber: true,
  statementCount: 3,
  activeMonths: 3,
  priceChangePct: 0,
};

const f = (over: Partial<SupplierFacts> = {}): SupplierFacts => ({ ...base, ...over });

describe("scoreDocuments", () => {
  it("من لا يصدر فواتير ولا عقد معه: رديء", () => {
    expect(scoreDocuments(f({ issuesInvoices: false })).grade).toBe("POOR");
  });

  it("العقد المكتوب يرفعه من رديء إلى مقبول", () => {
    expect(scoreDocuments(f({ issuesInvoices: false, contractOnFile: true })).grade).toBe("FAIR");
  });

  it("بلا فواتير بعد: غير مقيَّم لا رديء", () => {
    expect(scoreDocuments(f({ invoiceCount: 0 })).grade).toBe("UNRATED");
  });
});

describe("scoreVat", () => {
  it("من لا يصدر فواتير ضريبية لا خصم منه", () => {
    expect(scoreVat(f({ issuesInvoices: false })).grade).toBe("POOR");
  });

  it("ما لم يُقرأ لا يُحكَم عليه", () => {
    const s = scoreVat(f({ taxValidCount: 0, taxUnknownCount: 7 }));
    expect(s.grade).toBe("UNRATED");
    expect(s.reason).toContain("7");
  });

  it("المجهول لا يخفض النسبة — تُحسب على المحكوم عليه وحده", () => {
    const s = scoreVat(f({ taxValidCount: 10, taxInvalidCount: 0, taxUnknownCount: 90 }));
    expect(s.grade).toBe("GOOD");
  });

  it("حدود التقدير", () => {
    expect(scoreVat(f({ taxValidCount: 9, taxInvalidCount: 1 })).grade).toBe("GOOD");
    expect(scoreVat(f({ taxValidCount: 8, taxInvalidCount: 2 })).grade).toBe("FAIR");
    expect(scoreVat(f({ taxValidCount: 5, taxInvalidCount: 5 })).grade).toBe("POOR");
  });

  it("السبب يذكر عدد الناقصة كي يُفاوَض به", () => {
    expect(scoreVat(f({ taxValidCount: 5, taxInvalidCount: 5 })).reason).toContain("5");
  });
});

describe("scoreStatements", () => {
  it("لا كشف خلال أشهر تعامل: رديء", () => {
    expect(scoreStatements(f({ statementCount: 0, activeMonths: 4 })).grade).toBe("POOR");
  });

  it("كشفٌ لكل شهر: سليم", () => {
    expect(scoreStatements(f({ statementCount: 4, activeMonths: 4 })).grade).toBe("GOOD");
  });

  it("أقلّ من الأشهر: مقبول", () => {
    expect(scoreStatements(f({ statementCount: 1, activeMonths: 4 })).grade).toBe("FAIR");
  });

  it("بلا تعامل: غير مقيَّم", () => {
    expect(scoreStatements(f({ activeMonths: 0, statementCount: 0 })).grade).toBe("UNRATED");
  });
});

describe("scorePricing", () => {
  it("تعذُّر القياس لا يُنتج حكماً", () => {
    expect(scorePricing(f({ priceChangePct: null })).grade).toBe("UNRATED");
  });

  it("الانخفاض سليم مهما كبر", () => {
    expect(scorePricing(f({ priceChangePct: -30 })).grade).toBe("GOOD");
  });

  it("الثبات ضمن الحدّ سليم", () => {
    expect(scorePricing(f({ priceChangePct: 5 })).grade).toBe("GOOD");
    expect(scorePricing(f({ priceChangePct: -5 })).grade).toBe("GOOD");
  });

  it("الارتفاع المتوسّط مقبول والكبير رديء", () => {
    expect(scorePricing(f({ priceChangePct: 8 })).grade).toBe("FAIR");
    expect(scorePricing(f({ priceChangePct: 12 })).grade).toBe("FAIR");
    expect(scorePricing(f({ priceChangePct: 13 })).grade).toBe("POOR");
  });
});

describe("overallGrade", () => {
  it("الأسوأ هو الحاكم لا المعدّل", () => {
    const scores = buildSupplierHealth(f({ taxValidCount: 5, taxInvalidCount: 5 }));
    expect(overallGrade(scores)).toBe("POOR");
  });

  it("غير المقيَّم لا يُخفّف الحكم ولا يشدّده", () => {
    expect(overallGrade([
      { dimension: "VAT", grade: "GOOD", reason: "" },
      { dimension: "PRICING", grade: "UNRATED", reason: "" },
    ])).toBe("GOOD");
  });

  it("لا شيء مقيَّم فلا حكم", () => {
    expect(overallGrade([{ dimension: "PRICING", grade: "UNRATED", reason: "" }])).toBe("UNRATED");
    expect(overallGrade([])).toBe("UNRATED");
  });

  it("مورّد سليم في كل شيء", () => {
    expect(overallGrade(buildSupplierHealth(f()))).toBe("GOOD");
  });
});

describe("buildSupplierHealth", () => {
  it("أربعة أبعاد دائماً، ولكلٍّ سبب مكتوب", () => {
    const scores = buildSupplierHealth(f());
    expect(scores).toHaveLength(4);
    for (const s of scores) expect(s.reason.length).toBeGreaterThan(0);
  });
});
