import { describe, expect, it } from "vitest";
import { reconcile, weight, type Claim } from "./optimizer";
import type { Candidate } from "./candidates";

/**
 * المحسِّن — ما كانت تنجو فيه طفراتُ Stryker. أخطرُها: مكوّنةٌ نفدت ميزانيّتُها
 * ولا اختبارَ يقول إنّها تُعلَن «غير مثبتة». والحلّ التقريبيّ لا يُحسَم تلقائياً
 * إلّا إن عُرف أنّه تقريبيّ.
 */
function cand(over: Partial<Candidate> & { invoiceIds: string[]; score: number }): Candidate {
  return {
    outcome: "EXACT_INVOICE", allocatedMinor: 100_00,
    parts: { supplier: 1, amount: 1, date: 1, reference: 0 }, evidence: ["دليل"], ...over,
  };
}
const claim = (transactionId: string, c: Candidate): Claim => ({ transactionId, candidate: c });

/** ٢٢ حركة على ١٨ فاتورة، كلٌّ منها ترشّح كلَّها بدرجاتٍ متقاربة — تُنفد ميزانيّة البحث */
const hard = () => {
  const ids = Array.from({ length: 18 }, (_, i) => `H${i}`);
  return Array.from({ length: 22 }, (_, t) =>
    ids.map((id, k) => claim(`HT${String(t).padStart(2, "0")}`, cand({ invoiceIds: [id], score: 0.5 + ((t + k) % 17) / 100 }))),
  ).flat();
};

describe("نفادُ الميزانيّة يُعلَن ولا يُدَّعى اليقين", () => {
  const r = reconcile([...hard(), claim("E1", cand({ invoiceIds: ["e1"], score: 0.95 }))]);

  it("الحلّ «غير مثبت»، وحركاتُ المكوّنة الصعبة كلُّها مسمّاة مرتّبة — والسهلةُ ليست منها", () => {
    expect(r.exact).toBe(false);
    const expected = Array.from({ length: 22 }, (_, t) => `HT${String(t).padStart(2, "0")}`);
    expect(r.inexactTransactionIds).toEqual(expected);
  });

  it("وما رجع إليه (الجشع أو أفضلُ ما وُجد) لا يخصّص فاتورةً مرّتين ولا يترك فاتورةً تطلبها حركةٌ حرّة", () => {
    const used = r.assigned.flatMap((a) => a.candidate.invoiceIds);
    expect(new Set(used).size).toBe(used.length);
    expect(r.assigned.filter((a) => a.transactionId.startsWith("HT"))).toHaveLength(18);
    expect(r.unassigned.map((u) => u.transactionId)).toHaveLength(4);
  });

  it("والنتيجةُ مرتّبة: المخصَّص بالدرجة نزولاً، وغيرُ المخصَّص بالمعرّف", () => {
    const scores = r.assigned.map((a) => a.candidate.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const ids = r.unassigned.map((u) => u.transactionId);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});

describe("أحكامٌ صغيرة لا تُرى إلّا بنصّها", () => {
  it("الوزنُ الدرجةُ مرفوعةً إلى الرابعة — والسالبُ صفر", () => {
    expect(weight(0.5)).toBeCloseTo(0.0625, 10);
    expect(weight(0.9)).toBeCloseTo(0.6561, 10);
    expect(weight(-0.3)).toBe(0);
  });

  it("حركةٌ بلا خيارٍ ممكن تُذكر بأفضل ما حُرمت منه", () => {
    const r = reconcile([
      claim("T1", cand({ invoiceIds: ["A"], score: 0.95 })),
      claim("T2", cand({ invoiceIds: ["A"], score: 0.8 })),
      claim("T2", cand({ invoiceIds: ["A", "B"], score: 0.6 })),
    ]);
    expect(r.unassigned).toEqual([{ transactionId: "T2", bestBlockedScore: 0.8 }]);
  });

  it("عند تساوي الدرجة يُقدَّم المرشّحُ الأقلّ فواتير", () => {
    const r = reconcile([
      claim("T1", cand({ invoiceIds: ["A", "B"], score: 0.9 })),
      claim("T1", cand({ invoiceIds: ["C"], score: 0.9 })),
    ]);
    expect(r.assigned[0].candidate.invoiceIds).toEqual(["C"]);
    expect(r.assigned[0].runnerUpScore).toBe(0.9);
  });
});
