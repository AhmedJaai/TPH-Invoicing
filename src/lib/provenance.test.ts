import { describe, expect, it } from "vitest";
import { buildProvenance, confidenceOf, summarize, type Contribution } from "./provenance";

function c(over: Partial<Contribution> & { id: string }): Contribution {
  return {
    label: over.label ?? over.id,
    count: over.count ?? 1,
    amountMinor: over.amountMinor === undefined ? 1000 : over.amountMinor,
    included: over.included ?? true,
    reason: over.reason,
    href: over.href,
    id: over.id,
  };
}

describe("buildProvenance", () => {
  it("القيمة مجموع ما دخل وحده", () => {
    const p = buildProvenance([
      c({ id: "a", amountMinor: 5000, count: 3 }),
      c({ id: "b", amountMinor: 900_00, count: 2, included: false, reason: "لم تُقرأ" }),
    ]);
    expect(p.valueMinor).toBe(5000);
    expect(p.includedCount).toBe(3);
    expect(p.excludedCount).toBe(2);
  });

  it("المستبعَد المجهول مبلغه لا يُجمع ولا يُعدّ صفراً", () => {
    const p = buildProvenance([
      c({ id: "in", amountMinor: 10_000, count: 10 }),
      c({ id: "out", amountMinor: null, count: 2, included: false, reason: "بلا مبلغ مقروء" }),
    ]);
    expect(p.excludedKnownMinor).toBe(0);
    expect(p.excludedUnknownCount).toBe(2);
  });

  it("التغطية بالعدد لا بالمبلغ", () => {
    // مبلغ ضخم مستبعَد لا يهبط بالتغطية أكثر من مستند واحد
    const p = buildProvenance([
      c({ id: "in", amountMinor: 100, count: 9 }),
      c({ id: "out", amountMinor: 9_999_999, count: 1, included: false, reason: "محجور" }),
    ]);
    expect(p.coverage).toBeCloseTo(0.9);
  });

  it("لا تغطية بلا بيانات", () => {
    const p = buildProvenance([]);
    expect(p.coverage).toBeNull();
    expect(p.valueMinor).toBe(0);
    expect(p.confidence).toBe("LOW");
  });

  it("تغطية تامّة حين لا مستبعَد", () => {
    const p = buildProvenance([c({ id: "in", count: 4 })]);
    expect(p.coverage).toBe(1);
    expect(p.confidence).toBe("HIGH");
  });

  it("تُقدَّم المُدرَجات على المستبعَدات في العرض", () => {
    const p = buildProvenance([
      c({ id: "out", included: false, reason: "س" }),
      c({ id: "in" }),
    ]);
    expect(p.contributions.map((x) => x.id)).toEqual(["in", "out"]);
  });

  it("مساهمة بعدد صفر لا تُفسد التغطية", () => {
    const p = buildProvenance([c({ id: "in", count: 5 }), c({ id: "none", count: 0, included: false })]);
    expect(p.coverage).toBe(1);
  });
});

describe("confidenceOf", () => {
  it("حدود الثقة", () => {
    expect(confidenceOf(1)).toBe("HIGH");
    expect(confidenceOf(0.95)).toBe("HIGH");
    expect(confidenceOf(0.949)).toBe("MEDIUM");
    expect(confidenceOf(0.8)).toBe("MEDIUM");
    expect(confidenceOf(0.79)).toBe("LOW");
    expect(confidenceOf(null)).toBe("LOW");
  });
});

describe("summarize", () => {
  it("تذكر النقص صراحةً", () => {
    const p = buildProvenance([
      c({ id: "in", count: 117 }),
      c({ id: "out", count: 6, included: false, reason: "لم تُقرأ" }),
    ]);
    expect(summarize(p)).toBe("117 فاتورة · 6 خارج الرقم");
  });

  it("تقول مكتمل حين لا نقص", () => {
    expect(summarize(buildProvenance([c({ id: "in", count: 3 })]))).toBe("3 فاتورة · مكتمل");
  });

  it("تقول لا بيانات حين لا شيء", () => {
    expect(summarize(buildProvenance([]))).toBe("لا بيانات بعد");
  });
});
