import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_ORDER, deriveLifecycle, detectAnomalies, lifecycleRank,
  type LifecycleFacts,
} from "./lifecycle";

const f = (over: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
  classified: false, hasCandidate: false, decided: false, posted: false, ignored: false,
  ...over,
});

describe("طبقات الحركة", () => {
  it("الخام ما لم يُعرف عنه شيء", () => {
    expect(deriveLifecycle(f())).toBe("RAW");
  });

  /* المجهول طبقةٌ لا عيب: عُرف بابُها ولم يُعرف مقابلها بعد */
  it("عُرف بابُها فهي مُستنتَجة", () => {
    expect(deriveLifecycle(f({ classified: true }))).toBe("INFERRED");
  });

  it("رُجّح لها مقابل فهي مقترَحة", () => {
    expect(deriveLifecycle(f({ classified: true, hasCandidate: true }))).toBe("SUGGESTED");
  });

  it("حُسمت فهي مُقَرَّة", () => {
    expect(deriveLifecycle(f({ classified: true, hasCandidate: true, decided: true })))
      .toBe("CONFIRMED");
  });

  it("قُيّدت فهي مُقيَّدة", () => {
    expect(deriveLifecycle(f({ decided: true, posted: true }))).toBe("POSTED");
  });

  /*
    «ليست سداداً» إقرارٌ تامّ لا نقص — وكانت تُحسَب مع المعلَّق فتُنفَّخ
    قائمة المراجعة بما فُرغ منه.
  */
  it("«ليست سداداً» إقرارٌ تامّ", () => {
    expect(deriveLifecycle(f({ classified: true, ignored: true }))).toBe("CONFIRMED");
  });

  it("الترتيب خمسُ طبقات متصاعدة", () => {
    expect(LIFECYCLE_ORDER).toHaveLength(5);
    expect(lifecycleRank("RAW")).toBeLessThan(lifecycleRank("POSTED"));
  });
});

describe("العطب يُعرَض ولا يُصحَّح", () => {
  /*
    التصحيح الآليّ هنا يمحو الدليل: من يعرف أيّ الطرفين الصحيح؟
  */
  it("مالٌ كُتب بلا قرارٍ مسجَّل", () => {
    const a = detectAnomalies(f({ posted: true }));
    expect(a.map((x) => x.code)).toContain("POSTED_WITHOUT_DECISION");
  });

  it("قرارٌ لم يبلغ المال", () => {
    const a = detectAnomalies(f({ decided: true }));
    expect(a.map((x) => x.code)).toContain("DECIDED_NOT_POSTED");
  });

  it("قولان متناقضان عن حركةٍ واحدة", () => {
    const a = detectAnomalies(f({ posted: true, decided: true, ignored: true }));
    expect(a.map((x) => x.code)).toContain("POSTED_BUT_IGNORED");
  });

  it("الحال السليم بلا عطب", () => {
    expect(detectAnomalies(f({ classified: true, decided: true, posted: true }))).toEqual([]);
    expect(detectAnomalies(f({ classified: true, ignored: true, decided: true }))).toEqual([]);
    expect(detectAnomalies(f({ classified: true, hasCandidate: true }))).toEqual([]);
  });
});
