import { describe, expect, it, vi } from "vitest";
import {
  MAX_CASES_PER_RUN, adjudicate, toSuggestion,
  type AdjudicatorClient, type AdjudicationOutcome,
} from "./adjudicator.service";
import type { AdjudicationCase } from "@/lib/bank/adjudicate";
import type { Candidate } from "@/lib/bank/candidates";
import { toCanonical } from "@/lib/bank/canonical";

const tx = toCanonical({
  valueDate: new Date("2026-09-04T00:00:00Z"),
  amountMinor: 4_250_00,
  direction: "DEBIT",
  beneficiaryRaw: "المراعي",
  description: "حوالة",
});

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  invoiceIds: ["i1"],
  outcome: "EXACT_INVOICE",
  allocatedMinor: 4_250_00,
  parts: { supplier: 1, amount: 1, date: 1, reference: 0 },
  score: 0.8,
  evidence: [],
  ...over,
});

const oneCase = (over: Partial<AdjudicationCase> = {}): AdjudicationCase => ({
  transactionId: "T1",
  reason: "CLOSE_CANDIDATES",
  candidates: [cand(), cand({ invoiceIds: ["i2"], score: 0.79 })],
  note: "",
  ...over,
});

const txs = new Map([["T1", tx]]);
const labels = new Map([
  ["i1", { number: "INV-1", date: "2026-09-02", outstandingMinor: 4_250_00 }],
  ["i2", { number: "INV-2", date: "2026-09-03", outstandingMinor: 4_250_00 }],
]);

function client(over: Partial<AdjudicatorClient> = {}): AdjudicatorClient {
  return {
    name: "test",
    model: "m",
    isConfigured: () => true,
    judge: async () => ({
      verdict: { choice: "c1", confidence: 0.9, reason: "المبلغ يطابق", rejected: "" },
      durationMs: 10,
    }),
    ...over,
  };
}

describe("adjudicate", () => {
  it("لا يُستدعى مزوّدٌ غير مهيَّأ", async () => {
    const judge = vi.fn();
    const r = await adjudicate(client({ isConfigured: () => false, judge }), [oneCase()], txs, labels);
    expect(r).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("يختار من القائمة ويُرجع المرشّح الحقيقيّ", async () => {
    const [r] = await adjudicate(client(), [oneCase()], txs, labels);
    expect(r.candidate?.invoiceIds).toEqual(["i1"]);
    expect(r.refused).toBeNull();
  });

  it("يردّ اختراع مرشّح ولا يقبله", async () => {
    const [r] = await adjudicate(
      client({ judge: async () => ({
        verdict: { choice: "c99", confidence: 1, reason: "", rejected: "" }, durationMs: 5,
      }) }),
      [oneCase()], txs, labels,
    );
    expect(r.candidate).toBeNull();
    expect(r.refused).toContain("وليس في القائمة");
  });

  it("يقبل NONE بلا ردّ", async () => {
    const [r] = await adjudicate(
      client({ judge: async () => ({
        verdict: { choice: "NONE", confidence: 0, reason: "لا يترجّح", rejected: "" }, durationMs: 5,
      }) }),
      [oneCase()], txs, labels,
    );
    expect(r.candidate).toBeNull();
    expect(r.refused).toBeNull();
  });

  it("فشل الاستدعاء يُسجَّل ولا يُسقط الدفعة", async () => {
    const [r] = await adjudicate(
      client({ judge: async () => { throw new Error("انقطع"); } }),
      [oneCase()], txs, labels,
    );
    expect(r.refused).toContain("تعذّر الاستدعاء");
  });

  it("الحالة بلا مرشّحين لا تُستدعى — الحَكَم يختار ولا يبتكر", async () => {
    const judge = vi.fn();
    const r = await adjudicate(client({ judge }), [oneCase({ candidates: [] })], txs, labels);
    expect(r).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("يحدّ عدد الاستدعاءات في الدفعة", async () => {
    const many = Array.from({ length: MAX_CASES_PER_RUN + 10 }, (_, i) =>
      oneCase({ transactionId: `T${i}` }));
    const map = new Map(many.map((c) => [c.transactionId, tx]));
    const r = await adjudicate(client(), many, map, labels);
    expect(r).toHaveLength(MAX_CASES_PER_RUN);
  });

  it("يحفظ نسخة الموجِّه والمخطّط والمزوّد", async () => {
    const [r] = await adjudicate(client(), [oneCase()], txs, labels);
    expect(r.provider).toBe("test");
    expect(r.promptVersion.length).toBeGreaterThan(0);
    expect(r.schemaVersion.length).toBeGreaterThan(0);
  });
});

describe("toSuggestion", () => {
  const base: AdjudicationOutcome = {
    transactionId: "T1", candidate: cand(), confidence: 0.9,
    reason: "المبلغ يطابق", refused: null,
    provider: "gemini", model: "m", promptVersion: "v", schemaVersion: "v", durationMs: 10,
  };

  it("حكم الحَكَم اقتراحٌ لا مطابقة — النموذج لا يُقرّر مالاً", () => {
    const r = toSuggestion(base);
    expect(r.disposition).toBe("SUGGEST");
    expect(r.reasons.join(" ")).toContain("ينتظر إقرارك");
  });

  it("وما رُدّ حكمه يُترَك للمراجعة", () => {
    expect(toSuggestion({ ...base, refused: "خارج القائمة" }).disposition).toBe("REVIEW");
  });

  it("ومن لم يرجّح شيئاً كذلك", () => {
    const r = toSuggestion({ ...base, candidate: null });
    expect(r.disposition).toBe("REVIEW");
    expect(r.reasons.join(" ")).toContain("الترك أسلم");
  });

  it("لا حكمٌ يبلغ المطابقة التلقائية أبداً", () => {
    for (const o of [base, { ...base, confidence: 1 }]) {
      expect(toSuggestion(o).disposition).not.toBe("AUTO");
    }
  });
});
