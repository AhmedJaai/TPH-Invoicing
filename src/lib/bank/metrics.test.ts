import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE, RECALL_NOTE, computeMetrics, formatMetric, healthOf,
  type OutcomeCounts,
} from "./metrics";

const counts = (over: Partial<OutcomeCounts> = {}): OutcomeCounts => ({
  auto: 100, suggested: 50, review: 20,
  confirmedByHuman: 45, rejectedByHuman: 5, autoReversed: 1,
  totalCandidatesForMatching: 200, ...over,
});

const get = (c: OutcomeCounts, key: string) => computeMetrics(c).find((m) => m.key === key)!;

describe("المقاييس", () => {
  it("أربعة مقاييس لكلٍّ سؤالٌ مختلف", () => {
    expect(computeMetrics(counts()).map((m) => m.key))
      .toEqual(["stp", "false_auto", "precision", "coverage"]);
  });

  it("نسبة الحسم التلقائيّ من كلّ ما دخل المطابقة", () => {
    expect(get(counts(), "stp").value).toBe(0.5);
  });

  it("الدقّة تُحسَب على ما حكم فيه إنسان وحده", () => {
    // ٤٥ من ٥٠ — لا من ٢٠٠
    expect(get(counts(), "precision").value).toBe(0.9);
    expect(get(counts(), "precision").sample).toBe(50);
  });

  it("خطأ الحسم التلقائيّ من التلقائيّ وحده", () => {
    expect(get(counts(), "false_auto").value).toBe(0.01);
  });

  /*
    «دقّة ٩٧٪» محسوبةً على ما لم يراجعه أحد تعني «٩٧٪ من أحكامي توافق
    أحكامي». والمقياس الذي يقيس نفسه بنفسه يرتفع كلّما ازداد النظام
    ثقةً بخطئه.
  */
  it("بلا حكمِ إنسانٍ لا تُحسَب دقّة — ولا تُصفَّر ولا تُمَأّ", () => {
    const m = get(counts({ confirmedByHuman: 0, rejectedByHuman: 0 }), "precision");
    expect(m.value).toBeNull();
    expect(formatMetric(m)).toContain("لا بيانات");
  });

  it("العيّنة الصغيرة لا تُنتج نسبة", () => {
    const m = get(counts({ confirmedByHuman: 5, rejectedByHuman: 1 }), "precision");
    expect(m.value).toBeNull();
    expect(m.sample).toBe(6);
    expect(formatMetric(m)).toContain(String(MIN_SAMPLE));
  });

  it("وعند بلوغ الحدّ تُحسَب", () => {
    const m = get(counts({ confirmedByHuman: 18, rejectedByHuman: 2 }), "precision");
    expect(m.value).toBe(0.9);
  });
});

describe("الحكم على الحال", () => {
  /* خطأ التلقائيّ أخطر: يصير مالاً قبل أن يراه أحد */
  it("عتبة الخطأ التلقائيّ أضيق من غيرها", () => {
    expect(healthOf(get(counts({ autoReversed: 1 }), "false_auto"))).toBe("GOOD");
    expect(healthOf(get(counts({ autoReversed: 4 }), "false_auto"))).toBe("WATCH");
    expect(healthOf(get(counts({ autoReversed: 10 }), "false_auto"))).toBe("BAD");
  });

  it("والحسم القليل تعبٌ لا خطر", () => {
    expect(healthOf(get(counts({ auto: 160 }), "stp"))).toBe("GOOD");
    expect(healthOf(get(counts({ auto: 100 }), "stp"))).toBe("WATCH");
    expect(healthOf(get(counts({ auto: 40 }), "stp"))).toBe("BAD");
  });

  it("المجهول يُعلَن مجهولاً", () => {
    expect(healthOf(get(counts({ auto: 0, totalCandidatesForMatching: 0 }), "stp")))
      .toBe("UNKNOWN");
  });
});

describe("الاستدعاء", () => {
  /*
    مقامه «كل ما كان يجب أن يُطابَق» ولا سبيل إلى معرفته. والاجتهاد في
    تقديره يُنتج رقماً يبدو معلوماً وهو مخترَع.
  */
  it("لا يُقاس، ويُقال ذلك صراحةً", () => {
    expect(computeMetrics(counts()).some((m) => m.key === "recall")).toBe(false);
    expect(RECALL_NOTE).toContain("لا يُقاس");
    expect(RECALL_NOTE).toContain("حدٌّ أدنى");
  });
});
