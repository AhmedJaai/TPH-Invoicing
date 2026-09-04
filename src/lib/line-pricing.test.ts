import { describe, expect, it } from "vitest";
import { reconcileInvoiceLines, resolveLinePricing } from "./line-pricing";

const r = (quantity: number, unitPriceMinor: number | null, lineTotalMinor: number | null) =>
  resolveLinePricing({ quantity, unitPriceMinor, lineTotalMinor });

describe("resolveLinePricing", () => {
  it("الضرب المستقيم يُترك كما هو", () => {
    const p = r(5, 8_400, 42_000)!;
    expect(p.basis).toBe("CONSISTENT");
    expect(p.effectiveUnitMinor).toBe(8_400);
    expect(p.discountMinor).toBe(0);
  });

  it("خصم أفال: عشر وحدات بسعر قائمة ١٤٠ وإجمالي ٨٨٥٫٥٠ ← الوحدة ٨٨٫٥٥", () => {
    const p = r(10, 14_000, 88_550)!;
    expect(p.basis).toBe("DISCOUNTED");
    expect(p.effectiveUnitMinor).toBe(8_855);
    expect(p.listUnitMinor).toBe(14_000);
    expect(p.discountMinor).toBe(51_450);
  });

  it("خصم كولومبيا: خمس وحدات ١٧٥ وإجمالي ٥٥٣٫٤٤ ← الوحدة ١١٠٫٦٩", () => {
    expect(r(5, 17_500, 55_344)!.effectiveUnitMinor).toBe(11_069);
  });

  it("خصم إثيوبيا: خمس عشرة وحدة ١٦٠ وإجمالي ١٥١٨ ← الوحدة ١٠١٫٢٠", () => {
    expect(r(15, 16_000, 151_800)!.effectiveUnitMinor).toBe(10_120);
  });

  it("زاكوباك: الإجمالي شامل الضريبة ← سعر الوحدة الصافي هو الصحيح", () => {
    const p = r(1, 6_500, 7_475)!;
    expect(p.basis).toBe("TOTAL_INCLUDES_VAT");
    expect(p.effectiveUnitMinor).toBe(6_500);
    expect(p.netTotalMinor).toBe(6_500);
    expect(p.discountMinor).toBe(0);
  });

  it("الإجمالي الشامل للضريبة مع كمية أكبر", () => {
    const p = r(2, 6_500, 14_950)!;
    expect(p.basis).toBe("TOTAL_INCLUDES_VAT");
    expect(p.effectiveUnitMinor).toBe(6_500);
    expect(p.netTotalMinor).toBe(13_000);
  });

  it("بلا إجمالي: يُشتقّ من السعر والكمية", () => {
    const p = r(3, 5_000, null)!;
    expect(p.basis).toBe("DERIVED");
    expect(p.netTotalMinor).toBe(15_000);
    expect(p.effectiveUnitMinor).toBe(5_000);
  });

  it("بلا سعر وحدة: يُشتقّ من الإجمالي والكمية", () => {
    const p = r(4, null, 20_000)!;
    expect(p.basis).toBe("DERIVED");
    expect(p.effectiveUnitMinor).toBe(5_000);
  });

  it("بلا سعر ولا إجمالي: لا يُسجَّل السطر إطلاقاً", () => {
    expect(r(3, null, null)).toBeNull();
  });

  it("الكمية صفراً أو سالبة تُعامَل واحدةً بدل القسمة على صفر", () => {
    const p = r(0, 5_000, 5_000)!;
    expect(p.effectiveUnitMinor).toBe(5_000);
    expect(Number.isFinite(p.effectiveUnitMinor)).toBe(true);
  });

  it("التعارض الذي لا تفسّره ضريبة ولا خصم يُسم ولا يُبتلَع", () => {
    const p = r(2, 1_000, 9_000)!;
    expect(p.basis).toBe("INCONSISTENT");
    expect(p.effectiveUnitMinor).toBe(4_500);
  });

  it("فرق الهللات من التقريب لا يُعدّ خصماً", () => {
    expect(r(3, 3_333, 9_999)!.basis).toBe("CONSISTENT");
    expect(r(7, 1_429, 10_000)!.basis).toBe("CONSISTENT");
  });
});

describe("reconcileInvoiceLines", () => {
  const mk = (unit: number, total: number) => ({
    effectiveUnitMinor: unit, netTotalMinor: total,
    listUnitMinor: null, discountMinor: 0, basis: "CONSISTENT" as const,
  });

  it("مجموع البنود يساوي الصافي ← تُترك كما هي", () => {
    const r = reconcileInvoiceLines([mk(7_700, 115_500)], 115_500);
    expect(r.verdict).toBe("NET");
    expect(r.lines[0].effectiveUnitMinor).toBe(7_700);
  });

  it("أفال ٠٠٠٣٩: البنود شاملة الضريبة ← تُردّ إلى الصافي", () => {
    // صافي الفاتورة ١٥٤٠٫٠٠ ومجموع بنودها ١٧٧١٫٠٠ = الصافي × ١٫١٥
    const r = reconcileInvoiceLines([mk(8_855, 88_550), mk(8_855, 88_550)], 154_000);
    expect(r.verdict).toBe("WAS_VAT_INCLUSIVE");
    expect(r.lines[0].effectiveUnitMinor).toBe(7_700);
    expect(r.lines[0].netTotalMinor).toBe(77_000);
  });

  it("«الارتفاع ١٥٪» يختفي حين تُسوّى الفاتورتان بصافيهما", () => {
    const june17 = reconcileInvoiceLines([mk(7_700, 115_500)], 115_500);
    const june21 = reconcileInvoiceLines([mk(8_855, 88_550), mk(8_855, 88_550)], 154_000);
    expect(june21.lines[0].effectiveUnitMinor).toBe(june17.lines[0].effectiveUnitMinor);
  });

  it("سعر القائمة والخصم يُردّان معاً", () => {
    const line = { effectiveUnitMinor: 8_855, netTotalMinor: 88_550, listUnitMinor: 16_100, discountMinor: 72_450, basis: "DISCOUNTED" as const };
    const r = reconcileInvoiceLines([line], 77_000);
    expect(r.verdict).toBe("WAS_VAT_INCLUSIVE");
    expect(r.lines[0].listUnitMinor).toBe(14_000);
    expect(r.lines[0].discountMinor).toBe(63_000);
    expect(r.lines[0].basis).toBe("DISCOUNTED");
  });

  it("بلا صافٍ معلوم لا يُدّعى تحقّق", () => {
    expect(reconcileInvoiceLines([mk(100, 100)], null).verdict).toBe("UNVERIFIED");
    expect(reconcileInvoiceLines([mk(100, 100)], 0).verdict).toBe("UNVERIFIED");
  });

  it("المجموع الذي لا يوافق الصافي ولا الشامل يبقى غير محقَّق ولا يُعدَّل", () => {
    const r = reconcileInvoiceLines([mk(100, 5_000)], 9_000);
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.lines[0].netTotalMinor).toBe(5_000);
  });

  it("بلا بنود لا شيء يُسوّى", () => {
    expect(reconcileInvoiceLines([], 1_000).lines).toHaveLength(0);
  });
});
