import { describe, expect, it, vi } from "vitest";
import { MAX_CASES_PER_RUN, adjudicate } from "./adjudicator.service";
import type { AdjudicatorProvider } from "@/lib/bank/adjudicator-provider";
import type { AdjudicationCase } from "@/lib/bank/adjudicate";
import type { Candidate } from "@/lib/bank/candidates";
import { toCanonical } from "@/lib/bank/canonical";

const tx = toCanonical({
  valueDate: new Date("2026-09-04T00:00:00Z"),
  amountMinor: 4_250_00,
  direction: "DEBIT",
  beneficiaryRaw: "المراعي",
  description: "حوالة محلية",
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

const invoiceCase = (over: Partial<AdjudicationCase> = {}): AdjudicationCase => ({
  transactionId: "T1",
  kind: "INVOICE",
  reason: "CLOSE_CANDIDATES",
  candidates: [cand(), cand({ invoiceIds: ["i2"], score: 0.79 })],
  entityCandidates: [],
  note: "",
  ...over,
});

const entityCase = (): AdjudicationCase => ({
  transactionId: "T1",
  kind: "ENTITY",
  reason: "UNKNOWN_HIGH_VALUE",
  candidates: [],
  entityCandidates: [
    { counterpartyId: "C1", supplierId: "S1", displayName: "المراعي", score: 0.5, evidence: ["كلمة"] },
  ],
  note: "",
});

const transactions = new Map([["T1", tx]]);
const invoiceLabels = new Map([
  ["i1", { number: "INV-1", date: "2026-09-02", outstandingMinor: 4_250_00 }],
  ["i2", { number: "INV-2", date: "2026-09-03", outstandingMinor: 4_250_00 }],
]);

function provider(over: Partial<AdjudicatorProvider> = {}): AdjudicatorProvider {
  return {
    name: "test",
    model: "m",
    isConfigured: () => true,
    judge: async () => ({
      verdict: {
        choice: "c1",
        reasonCodes: ["AMOUNT_EXACT", "DATE_CLOSE"],
        confidence: 0.9,
        reason: "المبلغ يطابق",
      },
      durationMs: 10,
    }),
    ...over,
  };
}

const run = (cases: AdjudicationCase[], p = provider(), median: number | null = 500_00) =>
  adjudicate({
    cases, transactions, invoiceLabels,
    kindOf: () => "SUPPLIER_PAYMENT",
    medianAmountMinor: median,
    provider: p,
  });

describe("adjudicate — الحلقة كاملةً", () => {
  it("لا يُستدعى مزوّدٌ غير مهيَّأ", async () => {
    const judge = vi.fn();
    expect(await run([invoiceCase()], provider({ isConfigured: () => false, judge }))).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("يختار من القائمة ويردّ الاختراع", async () => {
    const [ok] = await run([invoiceCase()]);
    expect(ok.candidate?.invoiceIds).toEqual(["i1"]);

    const [bad] = await run([invoiceCase()], provider({
      judge: async () => ({
        verdict: { choice: "c99", reasonCodes: [], confidence: 1, reason: "" }, durationMs: 1,
      }),
    }));
    expect(bad.candidate).toBeNull();
    expect(bad.refused).toContain("وليس في القائمة");
  });

  it("يردّ الأدلّة التي ادّعاها ولم تقع", async () => {
    const [r] = await run([invoiceCase()], provider({
      judge: async () => ({
        verdict: {
          choice: "c1",
          reasonCodes: ["REFERENCE_MATCH", "ACCOUNT_MATCH", "HISTORICAL_PATTERN"],
          confidence: 0.95,
          reason: "",
        },
        durationMs: 1,
      }),
    }));
    expect(r.audit.refuted.length).toBeGreaterThan(0);
    expect(r.decision.disposition).toBe("REVIEW");
  });

  it("ثقةُ النموذج الضعيفة تُسقِط الحكم إلى مراجعة", async () => {
    const [r] = await run([invoiceCase()], provider({
      judge: async () => ({
        verdict: { choice: "c1", reasonCodes: ["AMOUNT_EXACT"], confidence: 0.2, reason: "" },
        durationMs: 1,
      }),
    }));
    expect(r.decision.disposition).toBe("REVIEW");
  });

  it("ولا يبلغ حكمُه المطابقة التلقائية أبداً", async () => {
    for (const c of [0.7, 0.99, 1]) {
      const [r] = await run([invoiceCase()], provider({
        judge: async () => ({
          verdict: { choice: "c1", reasonCodes: ["AMOUNT_EXACT"], confidence: c, reason: "" },
          durationMs: 1,
        }),
      }));
      expect(r.decision.disposition).not.toBe("AUTO");
    }
  });

  /**
   * المسار الذي كان ميّتاً: مبلغٌ كبير ومستفيد مجهول. كان يُنشَأ بلا
   * مرشّحين والحَكَم يرفض ما لا مرشّح له.
   */
  it("حالة الجهة تصل الحَكَم وتُرجع اختياراً", async () => {
    const [r] = await run([entityCase()]);
    expect(r.kind).toBe("ENTITY");
    expect(r.entityChoice?.name).toBe("المراعي");
    // وتعريف الجهة يحتاج إقراراً صريحاً لأنّه يُنشئ ذاكرة
    expect(r.decision.disposition).toBe("REVIEW");
    expect(r.decision.reasons.join(" ")).toContain("يعمّ على أمثاله");
  });

  it("وحالةٌ بلا مرشّحين لا تُستدعى", async () => {
    const judge = vi.fn();
    const empty: AdjudicationCase = { ...entityCase(), entityCandidates: [] };
    expect(await run([empty], provider({ judge }))).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("فشل الاستدعاء يُسجَّل ولا يُسقط الدفعة", async () => {
    const [r] = await run([invoiceCase()], provider({
      judge: async () => { throw new Error("انقطع"); },
    }));
    expect(r.refused).toContain("تعذّر الاستدعاء");
    expect(r.decision.disposition).toBe("REVIEW");
  });

  it("يحدّ عدد الاستدعاءات", async () => {
    const many = Array.from({ length: MAX_CASES_PER_RUN + 10 }, (_, i) =>
      invoiceCase({ transactionId: `T${i}` }));
    const map = new Map(many.map((c) => [c.transactionId, tx]));
    const r = await adjudicate({
      cases: many, transactions: map, invoiceLabels,
      kindOf: () => "SUPPLIER_PAYMENT", medianAmountMinor: 500_00, provider: provider(),
    });
    expect(r).toHaveLength(MAX_CASES_PER_RUN);
  });
});

describe("الأثر — كي يُجاب «لماذا؟» بعد ستّة أشهر", () => {
  it("يُحفَظ المزوّد والنموذج والنسختان والمدّة", async () => {
    const [r] = await run([invoiceCase()]);
    expect(r.provenance.provider).toBe("test");
    expect(r.provenance.model).toBe("m");
    expect(r.provenance.promptVersion.length).toBeGreaterThan(0);
    expect(r.provenance.schemaVersion.length).toBeGreaterThan(0);
    expect(r.provenance.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("وثقةُ النموذج وسببه ورموزه — المدَّعى والمقبول والمردود", async () => {
    const [r] = await run([invoiceCase()], provider({
      judge: async () => ({
        verdict: {
          choice: "c1", reasonCodes: ["AMOUNT_EXACT", "REFERENCE_MATCH"],
          confidence: 0.88, reason: "المبلغ يطابق تماماً",
        },
        durationMs: 42,
      }),
    }));
    expect(r.provenance.modelConfidence).toBe(0.88);
    expect(r.provenance.modelReason).toBe("المبلغ يطابق تماماً");
    expect(r.provenance.claimedCodes).toEqual(["AMOUNT_EXACT", "REFERENCE_MATCH"]);
    expect(r.provenance.upheldCodes).toContain("AMOUNT_EXACT");
    expect(r.provenance.refutedCodes).toContain("REFERENCE_MATCH");
  });

  it("والإشارات الستّ التي بُني عليها القرار", async () => {
    const [r] = await run([invoiceCase()]);
    expect(r.decision.signals).toHaveProperty("candidateScore");
    expect(r.decision.signals).toHaveProperty("margin");
    expect(r.decision.signals).toHaveProperty("evidenceQuality");
    expect(r.decision.signals).toHaveProperty("modelConfidence");
    expect(r.decision.signals).toHaveProperty("highValue");
    expect(r.decision.signals).toHaveProperty("highRisk");
  });
});
