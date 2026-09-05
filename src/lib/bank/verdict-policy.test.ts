import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_HIGH_VALUE_MINOR, MEDIAN_MULTIPLE, MIN_MODEL_CONFIDENCE,
  highValueThreshold, weighVerdict, type VerdictInput,
} from "./verdict-policy";
import { auditReasons, type EvidenceFacts } from "./reason-codes";

const facts: EvidenceFacts = {
  parts: { supplier: 1, amount: 1, date: 1, reference: 1 },
  margin: 0.2, hasMemory: true, hasAccountEvidence: true,
};

const input = (over: Partial<VerdictInput> = {}): VerdictInput => ({
  candidateScore: 0.9,
  margin: 0.2,
  audit: auditReasons(["AMOUNT_EXACT", "DATE_CLOSE"], facts),
  modelConfidence: 0.9,
  amountMinor: 1_000_00,
  kind: "SUPPLIER_PAYMENT",
  medianAmountMinor: 500_00,
  ...over,
});

describe("highValueThreshold — الكبير نسبيّ لا ثابت", () => {
  it("الوسيط الصغير لا ينزل بالحدّ تحت الأرضيّة", () => {
    expect(highValueThreshold(100_00)).toBe(ABSOLUTE_HIGH_VALUE_MINOR);
  });

  it("والوسيط الكبير يرفعه", () => {
    expect(highValueThreshold(5_000_00)).toBe(5_000_00 * MEDIAN_MULTIPLE);
  });

  it("بلا وسيط يُرجَع إلى المطلق", () => {
    expect(highValueThreshold(null)).toBe(ABSOLUTE_HIGH_VALUE_MINOR);
    expect(highValueThreshold(0)).toBe(ABSOLUTE_HIGH_VALUE_MINOR);
  });
});

describe("weighVerdict — ثقة النموذج إشارة لا حُكم", () => {
  it("لا يبلغ حكمُ النموذج المطابقةَ التلقائية أبداً", () => {
    for (const c of [0.7, 0.9, 1]) {
      expect(weighVerdict(input({ modelConfidence: c })).disposition).not.toBe("AUTO");
    }
  });

  it("الثقة الضعيفة تُسقِطه إلى مراجعة — وكانت تُتجاهَل تماماً", () => {
    const low = weighVerdict(input({ modelConfidence: MIN_MODEL_CONFIDENCE - 0.01 }));
    expect(low.disposition).toBe("REVIEW");
    expect(low.reasons.join(" ")).toContain("دون حدّ الالتفات");

    expect(weighVerdict(input({ modelConfidence: 0.9 })).disposition).toBe("SUGGEST");
  });

  it("الادّعاء الذي أكثره ساقط يُردّ", () => {
    const bad = auditReasons(
      ["REFERENCE_MATCH", "ACCOUNT_MATCH", "AMOUNT_EXACT"],
      { ...facts, parts: { supplier: 1, amount: 1, date: 1, reference: 0 }, hasAccountEvidence: false },
    );
    const r = weighVerdict(input({ audit: bad }));
    expect(r.disposition).toBe("REVIEW");
    expect(r.reasons.join(" ")).toContain("لم يقع");
  });

  it("الأبواب الخطرة تُراجَع مهما علت الثقة", () => {
    for (const kind of ["SALARY", "GOVERNMENT", "OWNER_TRANSFER", "ZAKAT"] as const) {
      const r = weighVerdict(input({ kind, modelConfidence: 1 }));
      expect(r.disposition).toBe("REVIEW");
    }
  });

  it("المبلغ الكبير يُنظَر فيه", () => {
    const r = weighVerdict(input({ amountMinor: 60_000_00, medianAmountMinor: 100_00 }));
    expect(r.disposition).toBe("REVIEW");
    expect(r.reasons.join(" ")).toContain("مبلغٌ كبير");
  });

  it("ونفس المبلغ في مقهىً أكبر لا يُعدّ كبيراً", () => {
    // ٦٠٬٠٠٠ ريال: كبيرة حيث الوسيط ١٠٠، عاديّة حيث الوسيط ١٠٬٠٠٠
    expect(weighVerdict(input({ amountMinor: 60_000_00, medianAmountMinor: 100_00 })).disposition)
      .toBe("REVIEW");
    expect(weighVerdict(input({ amountMinor: 60_000_00, medianAmountMinor: 10_000_00 })).disposition)
      .toBe("SUGGEST");
  });

  it("الإشارات تُحفَظ كي يُفهَم القرار بعد شهور", () => {
    const r = weighVerdict(input());
    expect(r.signals.candidateScore).toBe(0.9);
    expect(r.signals.evidenceQuality).toBe(1);
    expect(r.signals.modelConfidence).toBe(0.9);
    expect(typeof r.signals.highRisk).toBe("boolean");
  });

  it("وما ادّعاه النموذج ولم يقع يُذكر بعينه", () => {
    const mixed = auditReasons(
      ["AMOUNT_EXACT", "DATE_CLOSE", "REFERENCE_MATCH"],
      { ...facts, parts: { supplier: 1, amount: 1, date: 1, reference: 0 } },
    );
    const r = weighVerdict(input({ audit: mixed }));
    expect(r.reasons.join(" ")).toContain("REFERENCE_MATCH");
  });

  it("النتيجة ثابتة لنفس المدخل", () => {
    const i = input();
    expect(weighVerdict(i)).toEqual(weighVerdict(i));
  });
});
