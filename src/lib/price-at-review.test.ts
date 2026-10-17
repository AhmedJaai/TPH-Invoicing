import { describe, expect, it } from "vitest";
import { normalizeItem } from "./items";
import { itemKeys, priceMovesAtReview, priceObjection, type LastPrice } from "./price-at-review";

const last = (pairs: [string, number][]): Map<string, LastPrice> =>
  new Map(pairs.map(([name, unitPriceMinor]) => [normalizeItem(name), { unitPriceMinor, day: "2026-09-01" }]));

describe("مقارنة السعر لحظة المراجعة", () => {
  it("الارتفاع يقال بنقاط الأساس من آخر سعر عند المورّد نفسه", () => {
    const [m] = priceMovesAtReview([{ description: "حليب طازج ٢ لتر", unitPrice: "10.80" }], last([["حليب طازج ٢ لتر", 1_000]]));
    expect(m).toMatchObject({ nowMinor: 1_080, wasMinor: 1_000, deltaBp: 800, wasDay: "2026-09-01" });
  });

  it("الانخفاض سالب", () => {
    expect(priceMovesAtReview([{ description: "سكر", unitPrice: "9" }], last([["سكر", 1_000]]))[0].deltaBp).toBe(-1_000);
  });

  it("دون ٣٪ تقريب لا حركة", () => {
    expect(priceMovesAtReview([{ description: "سكر", unitPrice: "10.20" }], last([["سكر", 1_000]]))).toEqual([]);
  });

  it("سعر لم يقرأ أو لا سابقة له لا يقال عنه شيء — لا «0٪» عن مجهول", () => {
    const known = last([["سكر", 1_000]]);
    expect(priceMovesAtReview([{ description: "سكر", unitPrice: "" }], known)).toEqual([]);
    expect(priceMovesAtReview([{ description: "سكر", unitPrice: "abc" }], known)).toEqual([]);
    expect(priceMovesAtReview([{ description: "ملح", unitPrice: "50" }], known)).toEqual([]);
    expect(priceMovesAtReview([{ description: "سكر", unitPrice: "50" }], last([["سكر", 0]]))).toEqual([]);
  });

  it("الصنف المكرّر في الفاتورة يقال مرّة، والأثقل ارتفاعاً أوّلاً", () => {
    const moves = priceMovesAtReview(
      [{ description: "سكر", unitPrice: "11" }, { description: "سكر", unitPrice: "11" }, { description: "بنّ", unitPrice: "150" }],
      last([["سكر", 1_000], ["بنّ", 10_000]]),
    );
    expect(moves.map((m) => m.description)).toEqual(["بنّ", "سكر"]);
  });

  it("مفاتيح السؤال فريدة ومطبّعة", () => {
    expect(itemKeys([{ description: " سكر " }, { description: "سكر" }, { description: "" }])).toEqual([normalizeItem("سكر")]);
  });

  it("رسالة الاعتراض تذكر ما ارتفع وحده بسعريه", () => {
    const moves = priceMovesAtReview(
      [{ description: "سكر", unitPrice: "11" }, { description: "ملح", unitPrice: "5" }],
      last([["سكر", 1_000], ["ملح", 1_000]]),
    );
    const text = priceObjection("المراعي", moves, (m) => (m / 100).toFixed(2), (d) => d);
    expect(text).toContain("سكر: 11.00 (كان 10.00 في 2026-09-01)");
    expect(text).not.toContain("ملح");
  });
});
