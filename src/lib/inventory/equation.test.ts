import { describe, expect, it } from "vitest";
import { formatBp, stockVariance, theoreticalClosing, type StockTerms } from "./equation";
import { canonicalToQuantity, toCanonical } from "./units";

/** كيلوغراماتٌ بالوحدة المعياريّة (مِلّي‑جرام). */
const kg = (n: number) => toCanonical(n * 1000, "KG");

function terms(over: Partial<StockTerms> = {}): StockTerms {
  return {
    openingMilli: kg(5),
    purchasesMilli: kg(20),
    adjustmentsInMilli: 0,
    adjustmentsOutMilli: 0,
    theoreticalConsumptionMilli: kg(12),
    recordedWasteMilli: 0,
    ...over,
  };
}

describe("المعادلة", () => {
  it("افتتاحيّ ٥ + مشتريات ٢٠ − استهلاك ١٢ = ١٣ متوقَّعاً", () => {
    const closing = theoreticalClosing(terms());
    expect(canonicalToQuantity(closing!, "KG")).toBe(13);
  });

  it("والفعليّ ١٠٫٥ يعطي فرقاً ‑٢٫٥ كجم", () => {
    const r = stockVariance(terms(), kg(10.5));
    expect(canonicalToQuantity(r.varianceMilli!, "KG")).toBe(-2.5);
    /* الثانويّة: ٢٫٥ ÷ ١٣ = ١٩٫٢٣٪ من المخزون الختاميّ */
    expect(r.varianceBp).toBe(-1923);
    expect(formatBp(r.varianceBp)).toBe("\u2066−19.2٪\u2069");
    /* والأساسيّة: ٢٫٥ ÷ ١٢ = ٢٠٫٨٣٪ من الاستهلاك */
    expect(r.varianceConsumptionBp).toBe(-2083);
  });

  /*
    ── المقامُ الأساسيّ هو الاستهلاك ──

    ومقامُ المخزون الختاميّ يتضخّم كلّما قلّ ما بقي على الرفّ، فيُنذر
    أشدَّ ما يكون آخرَ الأسبوع حين يكون الرفّ فارغاً بحقّ.
  */
  it("استهلاكٌ ٣٠ وفرقٌ ‑١ ← الأساسيّة ‑٣٫٣٣٪ لا ‑١٠٪", () => {
    const r = stockVariance(
      terms({ openingMilli: kg(40), purchasesMilli: 0, theoreticalConsumptionMilli: kg(30) }),
      kg(9),
    );
    expect(canonicalToQuantity(r.varianceMilli!, "KG")).toBe(-1);
    expect(r.varianceConsumptionBp).toBe(-333);
    expect(formatBp(r.varianceConsumptionBp)).toBe("\u2066−3.3٪\u2069");
    /* والثانويّةُ تقول ١٠٪ — وهي التي كانت تُعرَض وحدها فتُخيف بلا وجه */
    expect(r.varianceBp).toBe(-1000);
  });

  it("واستهلاكٌ صفرٌ لا يُنتج نسبةً أساسيّة — ولا «∞٪» ولا «١٠٠٪»", () => {
    const r = stockVariance(
      terms({ openingMilli: kg(10), purchasesMilli: 0, theoreticalConsumptionMilli: 0 }),
      kg(9),
    );
    expect(r.varianceMilli).not.toBeNull();
    expect(r.varianceConsumptionBp).toBeNull();
  });

  it("والمتوقَّع ٦ مع فعليٍّ ٥٫٢ = ‑٠٫٨ كجم", () => {
    const r = stockVariance(
      terms({ openingMilli: kg(6), purchasesMilli: 0, theoreticalConsumptionMilli: 0 }),
      kg(5.2),
    );
    expect(canonicalToQuantity(r.varianceMilli!, "KG")).toBe(-0.8);
  });

  it("والهدرُ المسجَّل والتسوياتُ تدخل المعادلة", () => {
    const closing = theoreticalClosing(terms({
      recordedWasteMilli: kg(1),
      adjustmentsInMilli: kg(2),
      adjustmentsOutMilli: kg(0.5),
    }));
    /* ٥ + ٢٠ + ٢ − ٠٫٥ − ١٢ − ١ = ١٣٫٥ */
    expect(canonicalToQuantity(closing!, "KG")).toBe(13.5);
  });

  it("ولا يُقصّ المتوقَّع عند الصفر — السالبُ خبر", () => {
    const closing = theoreticalClosing(terms({ theoreticalConsumptionMilli: kg(40) }));
    expect(canonicalToQuantity(closing!, "KG")).toBe(-15);
  });
});

describe("المجهولُ ينتشر ولا يُبتلَع", () => {
  it("افتتاحيٌّ مجهول ⇒ المتوقَّعُ مجهول — لا ٢٠", () => {
    const r = stockVariance(terms({ openingMilli: null }), kg(10.5));
    expect(r.theoreticalClosingMilli).toBeNull();
    expect(r.varianceMilli).toBeNull();
    expect(r.varianceBp).toBeNull();
    expect(r.varianceConsumptionBp).toBeNull();
  });

  it("ومشترياتٌ فيها بندٌ لم تُعرَف كمّيّتُه ⇒ مجهول", () => {
    expect(theoreticalClosing(terms({ purchasesMilli: null }))).toBeNull();
  });

  it("واستهلاكٌ لا وصفةَ له ⇒ مجهول", () => {
    expect(theoreticalClosing(terms({ theoreticalConsumptionMilli: null }))).toBeNull();
  });

  it("وصنفٌ لم يُعَدّ ⇒ لا فرق — والمتوقَّعُ يبقى محسوباً", () => {
    const r = stockVariance(terms(), null);
    expect(canonicalToQuantity(r.theoreticalClosingMilli!, "KG")).toBe(13);
    expect(r.varianceMilli).toBeNull();
  });

  it("والقسمةُ على صفرٍ لا تُصلَح بمئةٍ ولا بصفر — النسبةُ غير معرَّفة", () => {
    const r = stockVariance(
      terms({ openingMilli: 0, purchasesMilli: kg(12), theoreticalConsumptionMilli: kg(12) }),
      kg(-1),
    );
    expect(r.theoreticalClosingMilli).toBe(0);
    expect(r.varianceBp).toBeNull();
    expect(formatBp(null)).toBe("غير معروف");
  });
});
