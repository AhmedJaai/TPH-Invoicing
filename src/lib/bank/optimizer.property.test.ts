import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { reconcile, weight, type Claim } from "./optimizer";
import { AUTO_MARGIN, AUTO_SCORE, NEVER_AUTO, SCORE_EPSILON, SUGGEST_SCORE, decide } from "./decision";
import type { Candidate } from "./candidates";
import type { Outcome } from "./taxonomy";

/**
 * خصائصُ التسوية الشاملة — ومعها حَكَمٌ بالقوّة الغاشمة.
 *
 * المدخلُ صغيرٌ عمداً (≤ ٦ حركات × ≤ ٣ مرشّحين على ≤ ٦ فواتير): يُعدّ فيه كلُّ
 * توزيعٍ ممكن ويُقارَن أفضلُها بما اختاره المحسِّن. فلا فاتورةٌ تُصرَف مرّتين،
 * ولا حركةٌ تأخذ مطالبتين، ولا يفوّت المحسِّنُ حلّاً أثقل.
 */
const RUNS = { numRuns: 500, seed: 20261010 };
const INVOICES = ["A", "B", "C", "D", "E", "F"];
const TXS = ["T1", "T2", "T3", "T4", "T5", "T6"];

/* درجاتٌ من شبكةٍ خشنة: يكثر التساوي، وهو موضعُ الخطأ */
const score = fc.integer({ min: 40, max: 100 }).map((n) => n / 100);

const candidate = (invoiceIds: string[], s: number, outcome: Outcome = "EXACT_INVOICE"): Candidate => ({
  invoiceIds,
  outcome,
  allocatedMinor: 100_00,
  parts: { supplier: 1, amount: 1, date: 1, reference: 0 },
  score: s,
  evidence: ["دليل"],
});

const claimsArb: fc.Arbitrary<Claim[]> = fc.array(
  fc.record({
    transactionId: fc.constantFrom(...TXS),
    invoiceIds: fc.uniqueArray(fc.constantFrom(...INVOICES), { minLength: 1, maxLength: 3 }),
    score,
  }),
  { maxLength: 14 },
).map((raw) => {
  /* لكلّ حركةٍ ثلاثةُ مرشّحين على الأكثر، ولا مرشّحان على الفواتير نفسها */
  const seen = new Set<string>();
  const count = new Map<string, number>();
  const out: Claim[] = [];
  for (const r of raw) {
    const key = `${r.transactionId}|${[...r.invoiceIds].sort().join(",")}`;
    const n = count.get(r.transactionId) ?? 0;
    if (seen.has(key) || n >= 3) continue;
    seen.add(key);
    count.set(r.transactionId, n + 1);
    out.push({ transactionId: r.transactionId, candidate: candidate(r.invoiceIds, r.score) });
  }
  return out;
});

/** أثقلُ توزيعٍ ممكن — بعدِّ الكلّ */
function bruteForceBest(claims: readonly Claim[]): number {
  const byTx = new Map<string, Claim[]>();
  for (const c of claims) byTx.set(c.transactionId, [...(byTx.get(c.transactionId) ?? []), c]);
  const groups = [...byTx.values()];
  let best = 0;
  const walk = (i: number, taken: ReadonlySet<string>, total: number) => {
    if (i === groups.length) { best = Math.max(best, total); return; }
    walk(i + 1, taken, total);
    for (const option of groups[i]) {
      if (option.candidate.invoiceIds.some((id) => taken.has(id))) continue;
      walk(i + 1, new Set([...taken, ...option.candidate.invoiceIds]), total + weight(option.candidate.score));
    }
  };
  walk(0, new Set(), 0);
  return best;
}

const totalWeight = (claims: readonly { candidate: Candidate }[]) =>
  claims.reduce((s, c) => s + weight(c.candidate.score), 0);

describe("reconcile — خصائص", () => {
  it("لا فاتورةٌ في مطابقتين، ولا حركةٌ بمطالبتين، وكلُّ حركةٍ لها حكم", () => {
    fc.assert(fc.property(claimsArb, (claims) => {
      const r = reconcile(claims);
      const used = r.assigned.flatMap((a) => a.candidate.invoiceIds);
      expect(new Set(used).size).toBe(used.length);
      const txs = [...r.assigned.map((a) => a.transactionId), ...r.unassigned.map((u) => u.transactionId)];
      expect(new Set(txs).size).toBe(txs.length);
      expect(new Set(txs)).toEqual(new Set(claims.map((c) => c.transactionId)));
      // وما اختير مرشّحٌ قُدِّم لتلك الحركة بعينها — لا يُخترَع
      for (const a of r.assigned) {
        expect(claims.some((c) => c.transactionId === a.transactionId && c.candidate === a.candidate)).toBe(true);
      }
    }), RUNS);
  });

  it("لا يفوّت حلّاً أثقل: وزنُه وزنُ أفضلِ توزيعٍ بالعدّ الشامل", () => {
    fc.assert(fc.property(claimsArb, (claims) => {
      const r = reconcile(claims);
      expect(r.exact).toBe(true);
      expect(r.inexactTransactionIds).toEqual([]);
      expect(totalWeight(r.assigned)).toBeCloseTo(bruteForceBest(claims), 9);
      expect(r.totalScore).toBeCloseTo(r.assigned.reduce((s, a) => s + a.candidate.score, 0), 9);
    }), RUNS);
  });

  it("ترتيبُ المدخل لا يغيّر جودةَ الحلّ ولا عددَ ما طوبق", () => {
    fc.assert(fc.property(
      claimsArb.chain((c) => fc.tuple(fc.constant(c), fc.shuffledSubarray(c, { minLength: c.length }))),
      ([claims, shuffled]) => {
        const a = reconcile(claims);
        const b = reconcile(shuffled);
        expect(totalWeight(b.assigned)).toBeCloseTo(totalWeight(a.assigned), 9);
        // والمدخلُ نفسه يعطي المخرجَ نفسه
        expect(reconcile(claims)).toEqual(a);
      },
    ), RUNS);
  });

  it("الوصيفُ مرشّحٌ آخر ما زال ممكناً لتلك الحركة — لا منافسٌ سُحبت فواتيره", () => {
    fc.assert(fc.property(claimsArb, (claims) => {
      const r = reconcile(claims);
      const takenBy = new Map<string, string>();
      for (const a of r.assigned) for (const id of a.candidate.invoiceIds) takenBy.set(id, a.transactionId);
      for (const a of r.assigned) {
        const possible = claims
          .filter((c) => c.transactionId === a.transactionId && c.candidate !== a.candidate)
          .filter((c) => c.candidate.invoiceIds.every((id) => (takenBy.get(id) ?? a.transactionId) === a.transactionId))
          .map((c) => c.candidate.score);
        expect(a.runnerUpScore).toBe(possible.length > 0 ? Math.max(...possible) : null);
      }
      for (const u of r.unassigned) {
        const mine = claims.filter((c) => c.transactionId === u.transactionId).map((c) => c.candidate.score);
        expect(u.bestBlockedScore).toBe(Math.max(...mine));
      }
    }), RUNS);
  });

  it("حركاتٌ لا تتشارك فاتورةً يُحلّ كلٌّ منها كأنّه وحده", () => {
    fc.assert(fc.property(claimsArb, claimsArb, (left, right) => {
      /* المجموعةُ الثانية على فواتيرَ وحركاتٍ أخرى */
      const other = right.map((c) => ({
        transactionId: `R-${c.transactionId}`,
        candidate: { ...c.candidate, invoiceIds: c.candidate.invoiceIds.map((id) => `R-${id}`) },
      }));
      const together = reconcile([...left, ...other]);
      expect(totalWeight(together.assigned))
        .toBeCloseTo(totalWeight(reconcile(left).assigned) + totalWeight(reconcile(other).assigned), 9);
    }), RUNS);
  });
});

describe("decide — خصائص", () => {
  const outcome = fc.constantFrom<Outcome>(
    "EXACT_INVOICE", "OVERPAYMENT", "PARTIAL_PAYMENT", "AMOUNT_MISMATCH", "DUPLICATE_PAYMENT",
  );
  const assignment = fc.record({
    score, outcome,
    runnerUpScore: fc.option(score, { nil: null }),
    ambiguity: fc.option(fc.constant("فواتيرُ متساويةُ المبلغ"), { nil: undefined }),
  });

  it("لا مطابقةَ تلقائيّة إلّا بالشرطين معاً — الدرجةُ فوق حدّها والفارقُ فوق حدّه", () => {
    fc.assert(fc.property(assignment, (a) => {
      const c = { ...candidate(["A"], a.score, a.outcome), ...(a.ambiguity ? { ambiguity: a.ambiguity } : {}) };
      const d = decide({ transactionId: "T", candidate: c, runnerUpScore: a.runnerUpScore });
      const margin = a.runnerUpScore === null ? 1 : a.score - a.runnerUpScore;
      const mayAuto = a.score >= AUTO_SCORE - SCORE_EPSILON
        && margin >= AUTO_MARGIN - SCORE_EPSILON
        && !NEVER_AUTO.includes(a.outcome)
        && !a.ambiguity;
      expect(d.disposition === "AUTO").toBe(mayAuto);
      if (a.score < SUGGEST_SCORE - SCORE_EPSILON) expect(d.disposition).toBe("REVIEW");
      // والقرارُ يحمل سببَه دائماً
      expect(d.reasons.length).toBeGreaterThan(1);
    }), { ...RUNS, numRuns: 2000 });
  });

  it("من المحسِّن إلى القرار: مرشّحان متقاربان لحركةٍ واحدة لا يُحسَمان", () => {
    fc.assert(fc.property(
      fc.integer({ min: 85, max: 100 }), fc.integer({ min: 0, max: 7 }),
      (top, gap) => {
        const r = reconcile([
          { transactionId: "T", candidate: candidate(["A"], top / 100) },
          { transactionId: "T", candidate: candidate(["B"], (top - gap) / 100) },
        ]);
        expect(r.assigned).toHaveLength(1);
        expect(decide(r.assigned[0]).disposition).toBe("SUGGEST");
      },
    ), RUNS);
  });
});
