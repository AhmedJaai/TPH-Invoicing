import { describe, expect, it } from "vitest";
import {
  CLOSE_MARGIN, HIGH_VALUE_MINOR, needsAdjudication, planAdjudication,
  type CaseInput,
} from "./adjudicate";
import type { Candidate } from "./candidates";

const cand = (score: number, ids: string[] = ["a"]): Candidate => ({
  invoiceIds: ids,
  outcome: "EXACT_INVOICE",
  allocatedMinor: 100_00,
  parts: { supplier: 1, amount: 1, date: 1, reference: 0 },
  score,
  evidence: [],
});

const input = (over: Partial<CaseInput> = {}): CaseInput => ({
  transactionId: "T1",
  amountMinor: 100_00,
  supplierId: "S1",
  candidates: [],
  decision: null,
  ...over,
});

describe("needsAdjudication", () => {
  it("ما حُسم تلقائياً لا يُعاد فيه النظر أبداً", () => {
    const r = needsAdjudication(input({
      decision: { disposition: "AUTO", reasons: [] },
      candidates: [cand(0.9), cand(0.89)],
    }));
    expect(r).toBeNull();
  });

  it("مرشّحان متقاربان يستحقّان حَكَماً", () => {
    const r = needsAdjudication(input({ candidates: [cand(0.8), cand(0.78)] })!);
    expect(r?.reason).toBe("CLOSE_CANDIDATES");
    expect(r?.candidates).toHaveLength(2);
  });

  it("ومتباعدان لا يستحقّان", () => {
    expect(needsAdjudication(input({ candidates: [cand(0.9), cand(0.4)] }))).toBeNull();
  });

  it("حدّ التقارب مضبوط", () => {
    expect(needsAdjudication(input({ candidates: [cand(0.8), cand(0.8 - CLOSE_MARGIN + 0.001)] })))
      .not.toBeNull();
    expect(needsAdjudication(input({ candidates: [cand(0.8), cand(0.8 - CLOSE_MARGIN - 0.01)] })))
      .toBeNull();
  });

  it("المبلغ الكبير المجهول مستفيده يستحقّ", () => {
    const r = needsAdjudication(input({ supplierId: null, amountMinor: HIGH_VALUE_MINOR }));
    expect(r?.reason).toBe("UNKNOWN_HIGH_VALUE");
  });

  it("والصغير المجهول لا يستحقّ كلفة نموذج", () => {
    expect(needsAdjudication(input({ supplierId: null, amountMinor: HIGH_VALUE_MINOR - 1 })))
      .toBeNull();
  });

  it("لا يُعرَض على الحَكَم إلّا مرشّحون مولَّدون — لا بيانات خام", () => {
    const r = needsAdjudication(input({ candidates: [cand(0.8), cand(0.79)] }))!;
    for (const c of r.candidates) expect(c.invoiceIds.length).toBeGreaterThan(0);
  });

  it("ولا يُعرَض أكثر من خمسة", () => {
    const many = Array.from({ length: 12 }, (_, i) => cand(0.8 - i * 0.001, [`i${i}`]));
    const r = needsAdjudication(input({ candidates: many }))!;
    expect(r.candidates.length).toBeLessThanOrEqual(5);
  });
});

describe("planAdjudication", () => {
  it("النسبة صغيرة — وهذا هو الفرق بين استعمال الذكاء وإدمانه", () => {
    const plan = planAdjudication([
      ...Array.from({ length: 270 }, (_, i) =>
        input({ transactionId: `auto${i}`, decision: { disposition: "AUTO", reasons: [] } })),
      ...Array.from({ length: 6 }, (_, i) =>
        input({ transactionId: `close${i}`, candidates: [cand(0.8), cand(0.79)] })),
    ]);
    expect(plan.cases).toHaveLength(6);
    expect(plan.skipped).toBe(270);
    expect(plan.rate).toBeCloseTo(6 / 276, 4);
  });

  it("لا مدخلات فلا تحكيم ولا قسمة على صفر", () => {
    expect(planAdjudication([])).toEqual({ cases: [], skipped: 0, rate: 0 });
  });
});
