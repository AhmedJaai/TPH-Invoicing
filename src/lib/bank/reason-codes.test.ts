import { describe, expect, it } from "vitest";
import {
  ALL_REASON_CODES, auditReasons, evidenceQuality, holds, type EvidenceFacts,
} from "./reason-codes";

const facts = (over: Partial<EvidenceFacts> = {}): EvidenceFacts => ({
  parts: { supplier: 1, amount: 1, date: 1, reference: 1 },
  margin: 0.2,
  hasMemory: true,
  hasAccountEvidence: true,
  ...over,
});

describe("holds — السبب يُقابَل بما حُسب", () => {
  it("«المبلغ يطابق تماماً» تعني درجةً كاملة لا قريبة", () => {
    expect(holds("AMOUNT_EXACT", facts({ parts: { supplier: 1, amount: 1, date: 1, reference: 0 } }))).toBe(true);
    expect(holds("AMOUNT_EXACT", facts({ parts: { supplier: 1, amount: 0.99, date: 1, reference: 0 } }))).toBe(false);
    // والقريب يبقى قريباً
    expect(holds("AMOUNT_CLOSE", facts({ parts: { supplier: 1, amount: 0.99, date: 1, reference: 0 } }))).toBe(true);
  });

  it("المرجع لا يُدَّعى وهو صفر", () => {
    expect(holds("REFERENCE_MATCH", facts({ parts: { supplier: 1, amount: 1, date: 1, reference: 0 } }))).toBe(false);
  });

  it("الفارق يُشترَط له قدرٌ معتبر", () => {
    expect(holds("CANDIDATE_MARGIN", facts({ margin: 0.05 }))).toBe(true);
    expect(holds("CANDIDATE_MARGIN", facts({ margin: 0.01 }))).toBe(false);
  });

  it("«لا منافس له» تعني غياب المنافس لا ضعفه", () => {
    expect(holds("ONLY_CANDIDATE", facts({ margin: null }))).toBe(true);
    expect(holds("ONLY_CANDIDATE", facts({ margin: 0.9 }))).toBe(false);
  });

  it("النمط السابق يحتاج ذاكرةً لا ظنّاً", () => {
    expect(holds("HISTORICAL_PATTERN", facts({ hasMemory: false }))).toBe(false);
  });
});

describe("auditReasons — النموذج يُثبت لا يختار", () => {
  it("يقبل ما وقع", () => {
    const a = auditReasons(["AMOUNT_EXACT", "DATE_CLOSE"], facts());
    expect(a.upheld).toEqual(["AMOUNT_EXACT", "DATE_CLOSE"]);
    expect(a.refuted).toEqual([]);
  });

  it("يردّ ما ادّعاه ولم يقع — بعينه لا عدداً", () => {
    const a = auditReasons(
      ["REFERENCE_MATCH", "AMOUNT_EXACT"],
      facts({ parts: { supplier: 1, amount: 1, date: 1, reference: 0 } }),
    );
    expect(a.refuted).toEqual(["REFERENCE_MATCH"]);
    expect(a.upheld).toEqual(["AMOUNT_EXACT"]);
  });

  it("يعزل ما ليس من القائمة أصلاً", () => {
    const a = auditReasons(["VIBES", "AMOUNT_EXACT"], facts());
    expect(a.unknown).toEqual(["VIBES"]);
  });

  it("يتجاهل الفراغ وحالة الأحرف", () => {
    expect(auditReasons([" amount_exact "], facts()).upheld).toEqual(["AMOUNT_EXACT"]);
  });

  it("كل الرموز معرَّفة ولها فحص", () => {
    for (const c of ALL_REASON_CODES) expect(typeof holds(c, facts())).toBe("boolean");
  });
});

describe("evidenceQuality", () => {
  it("نسبة ما صحّ ممّا ادّعى", () => {
    const a = auditReasons(
      ["AMOUNT_EXACT", "REFERENCE_MATCH"],
      facts({ parts: { supplier: 1, amount: 1, date: 1, reference: 0 } }),
    );
    expect(evidenceQuality(a)).toBe(0.5);
  });

  it("ادّعاءٌ سقط كلّه يختلف عن ألّا يدّعي شيئاً", () => {
    const none = auditReasons([], facts());
    expect(evidenceQuality(none)).toBeNull();

    const allFalse = auditReasons(["REFERENCE_MATCH"],
      facts({ parts: { supplier: 1, amount: 1, date: 1, reference: 0 } }));
    expect(evidenceQuality(allFalse)).toBe(0);
  });
});
