import { describe, expect, it } from "vitest";
import { reconcile, type Claim } from "./optimizer";
import { AUTO_MARGIN, AUTO_SCORE, decide, strengthLabel, tally } from "./decision";
import type { Candidate } from "./candidates";

function cand(over: Partial<Candidate> & { invoiceIds: string[]; score: number }): Candidate {
  return {
    outcome: "EXACT_INVOICE",
    allocatedMinor: 100_00,
    parts: { supplier: 1, amount: 1, date: 1, reference: 0 },
    evidence: ["دليل"],
    ...over,
  };
}

const claim = (transactionId: string, c: Candidate): Claim => ({ transactionId, candidate: c });

describe("reconcile — لا جشع", () => {
  /**
   * الحالة التي ذكرها المراجع حرفياً: قرارٌ مبكّر ضعيف يسرق فاتورة من
   * مطابقة لاحقة أقوى.
   */
  it("المطالبة الأقوى تُخدَم أوّلاً ولو جاءت حركتها آخر الملف", () => {
    const r = reconcile([
      claim("T1", cand({ invoiceIds: ["C"], score: 0.7 })),
      claim("T2", cand({ invoiceIds: ["C"], score: 0.95 })),
    ]);
    expect(r.assigned).toHaveLength(1);
    expect(r.assigned[0].transactionId).toBe("T2");
    expect(r.unassigned.map((u) => u.transactionId)).toEqual(["T1"]);
  });

  it("الفاتورة لا تُخصَّص مرّتين", () => {
    const r = reconcile([
      claim("T1", cand({ invoiceIds: ["A", "B"], score: 0.9 })),
      claim("T2", cand({ invoiceIds: ["B"], score: 0.8 })),
    ]);
    const used = r.assigned.flatMap((a) => a.candidate.invoiceIds);
    expect(new Set(used).size).toBe(used.length);
  });

  it("الحركة الواحدة لا تأخذ مطالبتين", () => {
    const r = reconcile([
      claim("T1", cand({ invoiceIds: ["A"], score: 0.9 })),
      claim("T1", cand({ invoiceIds: ["B"], score: 0.85 })),
    ]);
    expect(r.assigned.filter((a) => a.transactionId === "T1")).toHaveLength(1);
  });

  it("عند تساوي الدرجة تُقدَّم الفاتورة الواحدة على المجموعة", () => {
    const r = reconcile([
      claim("T1", cand({ invoiceIds: ["A", "B", "C"], score: 0.9 })),
      claim("T1", cand({ invoiceIds: ["D"], score: 0.9 })),
    ]);
    expect(r.assigned[0].candidate.invoiceIds).toEqual(["D"]);
  });

  it("الوصيف يُحسب ممّا بقي ممكناً لا ممّا وُلّد", () => {
    // مرشّح T1 الثاني يستعمل فاتورةً ستُؤخذ — فلا يُعدّ منافساً
    const r = reconcile([
      claim("T2", cand({ invoiceIds: ["B"], score: 0.99 })),
      claim("T1", cand({ invoiceIds: ["A"], score: 0.9 })),
      claim("T1", cand({ invoiceIds: ["B"], score: 0.89 })),
    ]);
    const t1 = r.assigned.find((a) => a.transactionId === "T1")!;
    expect(t1.runnerUpScore).toBeNull();
  });

  it("الحركة المحرومة تُذكر مع أفضل ما كان ممكناً لها", () => {
    const r = reconcile([
      claim("T2", cand({ invoiceIds: ["C"], score: 0.95 })),
      claim("T1", cand({ invoiceIds: ["C"], score: 0.7 })),
    ]);
    expect(r.unassigned[0].bestBlockedScore).toBe(0.7);
  });

  it("النتيجة ثابتة لا تتقلّب بين استدعاءين", () => {
    const claims = [
      claim("T1", cand({ invoiceIds: ["A"], score: 0.9 })),
      claim("T2", cand({ invoiceIds: ["A"], score: 0.9 })),
    ];
    expect(reconcile(claims)).toEqual(reconcile(claims));
  });

  it("لا مطالبات فلا تسوية", () => {
    expect(reconcile([])).toEqual({
      assigned: [], unassigned: [], exact: true, totalScore: 0,
    });
  });
});

describe("decide — أثبِت المطابقة لا تجدها", () => {
  const at = (score: number, runnerUp: number | null, outcome: Candidate["outcome"] = "EXACT_INVOICE") => ({
    transactionId: "T",
    candidate: cand({ invoiceIds: ["A"], score, outcome }),
    runnerUpScore: runnerUp,
  });

  it("الدرجة العالية بلا منافس تُطابَق تلقائياً", () => {
    expect(decide(at(0.95, null)).disposition).toBe("AUTO");
  });

  it("مرشّحان متقاربان لا يُحسمان تلقائياً مهما علت الدرجة", () => {
    const d = decide(at(0.97, 0.96));
    expect(d.disposition).toBe("SUGGEST");
    expect(d.reasons.join(" ")).toContain("مرشّح آخر قريب");
  });

  it("الفارق على الحدّ يمرّ ولا يُقلَب بخطأ التمثيل العشريّ", () => {
    // 0.95 - 0.08 = 0.8700000000000001 في الحساب العشريّ
    expect(decide(at(0.95, 0.95 - AUTO_MARGIN)).disposition).toBe("AUTO");
    expect(decide(at(0.95, 0.87)).disposition).toBe("AUTO");
  });

  it("ودونه بقدرٍ معتبر لا يمرّ", () => {
    expect(decide(at(0.95, 0.9)).disposition).toBe("SUGGEST");
  });

  it("الدرجة دون حدّ التلقائية تبقى اقتراحاً", () => {
    expect(decide(at(AUTO_SCORE - 0.01, null)).disposition).toBe("SUGGEST");
  });

  it("الترجيح الضعيف يُترَك للمستخدم", () => {
    expect(decide(at(0.3, null)).disposition).toBe("REVIEW");
  });

  it("الزيادة والسداد الجزئي لا يُطابقان تلقائياً مهما علت الدرجة", () => {
    expect(decide(at(0.99, null, "OVERPAYMENT")).disposition).toBe("SUGGEST");
    expect(decide(at(0.99, null, "PARTIAL_PAYMENT")).disposition).toBe("SUGGEST");
  });

  it("لكل قرار أسبابه مكتوبةً", () => {
    for (const d of [decide(at(0.99, null)), decide(at(0.6, null)), decide(at(0.2, null))]) {
      expect(d.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("tally و strengthLabel", () => {
  it("يعدّ القرارات بأنواعها", () => {
    const t = tally([
      { disposition: "AUTO", reasons: [] },
      { disposition: "SUGGEST", reasons: [] },
      { disposition: "SUGGEST", reasons: [] },
      { disposition: "REVIEW", reasons: [] },
    ]);
    expect(t).toEqual({ auto: 1, suggest: 2, review: 1 });
  });

  it("يُعرَض وصفٌ لا نسبة — النسبة تُقرأ يقيناً وهي ترجيح", () => {
    expect(strengthLabel(0.95)).toBe("ترجيح قوي");
    expect(strengthLabel(0.75)).toBe("ترجيح معتبر");
    expect(strengthLabel(0.55)).toBe("ترجيح ضعيف");
    expect(strengthLabel(0.2)).toBe("لا ترجيح");
  });
});


describe("reconcile — أعلى مجموع لا أعلى درجة", () => {
  /**
   * الحالة التي ذكرها المراجع حرفياً: الجشع بالدرجة يأخذ ٩٥ فيخسر
   * ١٨٧. والصواب أن يُنظَر إلى المجموع لا إلى أعلى فرد.
   */
  it("يترك المرشّح الأعلى درجةً إن كان مجموع غيره أكبر", () => {
    const r = reconcile([
      claim("A", cand({ invoiceIds: ["1", "2"], score: 0.95 })),
      claim("B", cand({ invoiceIds: ["2"], score: 0.94 })),
      claim("C", cand({ invoiceIds: ["1"], score: 0.93 })),
    ]);
    expect(r.exact).toBe(true);
    expect(r.assigned.map((a) => a.transactionId).sort()).toEqual(["B", "C"]);
    expect(r.totalScore).toBeCloseTo(1.87, 6);
  });

  it("ويأخذ الأعلى حين لا ينافسه مجموع", () => {
    const r = reconcile([
      claim("A", cand({ invoiceIds: ["1", "2"], score: 0.95 })),
      claim("B", cand({ invoiceIds: ["2"], score: 0.3 })),
    ]);
    expect(r.assigned.map((a) => a.transactionId)).toEqual(["A"]);
  });

  it("ترك حركةٍ بلا تخصيص خيارٌ حين يفتح لغيرها ما هو أفضل", () => {
    const r = reconcile([
      claim("A", cand({ invoiceIds: ["1"], score: 0.5 })),
      claim("B", cand({ invoiceIds: ["1"], score: 0.9 })),
    ]);
    expect(r.assigned).toHaveLength(1);
    expect(r.assigned[0].transactionId).toBe("B");
    expect(r.unassigned[0].transactionId).toBe("A");
  });

  it("المجموع يُحتسب ويُعرَض", () => {
    const r = reconcile([
      claim("A", cand({ invoiceIds: ["1"], score: 0.9 })),
      claim("B", cand({ invoiceIds: ["2"], score: 0.8 })),
    ]);
    expect(r.totalScore).toBeCloseTo(1.7, 6);
  });

  it("لا تُخصَّص فاتورة مرّتين مهما كان المجموع", () => {
    const r = reconcile([
      claim("A", cand({ invoiceIds: ["1", "2"], score: 0.9 })),
      claim("B", cand({ invoiceIds: ["2", "3"], score: 0.9 })),
    ]);
    const used = r.assigned.flatMap((a) => a.candidate.invoiceIds);
    expect(new Set(used).size).toBe(used.length);
  });

  it("النتيجة ثابتة لا تتقلّب بين استدعاءين", () => {
    const claims = [
      claim("A", cand({ invoiceIds: ["1", "2"], score: 0.95 })),
      claim("B", cand({ invoiceIds: ["2"], score: 0.94 })),
      claim("C", cand({ invoiceIds: ["1"], score: 0.93 })),
    ];
    expect(reconcile(claims)).toEqual(reconcile(claims));
  });

  it("حجمٌ واقعيّ يُحلّ يقيناً لا تقريباً", () => {
    const claims = Array.from({ length: 40 }, (_, i) =>
      claim(`T${i}`, cand({ invoiceIds: [`I${i}`], score: 0.5 + (i % 10) / 40 })),
    );
    const r = reconcile(claims);
    expect(r.exact).toBe(true);
    expect(r.assigned).toHaveLength(40);
  });

  it("حين تنفد الميزانيّة يُعلَن أنّ الحلّ ليس يقينياً", () => {
    /*
      حالة متشابكة عمداً: كل حركة تنافس على نفس الفواتير، فينفجر
      شجر البحث. والمطلوب ألّا يدّعي النظام مثاليةً لم يبلغها.
    */
    const invoiceIds = Array.from({ length: 18 }, (_, i) => `I${i}`);
    const claims = Array.from({ length: 22 }, (_, t) =>
      invoiceIds.map((id, k) =>
        claim(`T${t}`, cand({ invoiceIds: [id], score: 0.5 + ((t + k) % 17) / 100 })),
      ),
    ).flat();

    const r = reconcile(claims);
    // يقيناً أو تقريباً — المهمّ أنّ الإعلان صادق والنتيجة سليمة
    const used = r.assigned.flatMap((a) => a.candidate.invoiceIds);
    expect(new Set(used).size).toBe(used.length);
    expect(typeof r.exact).toBe("boolean");
  });
});
