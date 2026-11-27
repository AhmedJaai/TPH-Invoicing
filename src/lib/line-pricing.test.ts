import { describe, expect, it } from "vitest";
import { packQuantity, parseLineQuantity, reconcileInvoiceLines, resolveLinePricing, resolveReadLines, unitPriceCandidates } from "./line-pricing";

const r = (quantity: number, unitPriceMinor: number | null, lineTotalMinor: number | null) =>
  resolveLinePricing({ quantity, unitPriceMinor, lineTotalMinor });

describe("resolveLinePricing", () => {
  it("الضرب المستقيم يترك كما هو", () => {
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

  it("بلا إجمالي: يشتقّ من السعر والكمية", () => {
    const p = r(3, 5_000, null)!;
    expect(p.basis).toBe("DERIVED");
    expect(p.netTotalMinor).toBe(15_000);
    expect(p.effectiveUnitMinor).toBe(5_000);
  });

  it("بلا سعر وحدة: يشتقّ من الإجمالي والكمية", () => {
    const p = r(4, null, 20_000)!;
    expect(p.basis).toBe("DERIVED");
    expect(p.effectiveUnitMinor).toBe(5_000);
  });

  it("بلا سعر ولا إجمالي: لا يسجّل السطر إطلاقاً", () => {
    expect(r(3, null, null)).toBeNull();
  });

  it("الكمية صفراً أو سالبة تعامل واحدةً بدل القسمة على صفر", () => {
    const p = r(0, 5_000, 5_000)!;
    expect(p.effectiveUnitMinor).toBe(5_000);
    expect(Number.isFinite(p.effectiveUnitMinor)).toBe(true);
  });

  it("التعارض الذي لا تفسّره ضريبة ولا خصم يسم ولا يبتلع", () => {
    const p = r(2, 1_000, 9_000)!;
    expect(p.basis).toBe("INCONSISTENT");
    expect(p.effectiveUnitMinor).toBe(4_500);
  });

  it("فرق الهللات من التقريب لا يعدّ خصماً", () => {
    expect(r(3, 3_333, 9_999)!.basis).toBe("CONSISTENT");
    expect(r(7, 1_429, 10_000)!.basis).toBe("CONSISTENT");
  });
});

describe("reconcileInvoiceLines", () => {
  const mk = (unit: number, total: number) => ({
    effectiveUnitMinor: unit, netTotalMinor: total,
    listUnitMinor: null, discountMinor: 0, basis: "CONSISTENT" as const,
  });

  it("مجموع البنود يساوي الصافي ← تترك كما هي", () => {
    const r = reconcileInvoiceLines([mk(7_700, 115_500)], 115_500);
    expect(r.verdict).toBe("NET");
    expect(r.lines[0].effectiveUnitMinor).toBe(7_700);
  });

  it("أفال ٠٠٠٣٩: البنود شاملة الضريبة ← تردّ إلى الصافي", () => {
    // صافي الفاتورة ١٥٤٠٫٠٠ ومجموع بنودها ١٧٧١٫٠٠ = الصافي × ١٫١٥
    const r = reconcileInvoiceLines([mk(8_855, 88_550), mk(8_855, 88_550)], 154_000);
    expect(r.verdict).toBe("WAS_VAT_INCLUSIVE");
    expect(r.lines[0].effectiveUnitMinor).toBe(7_700);
    expect(r.lines[0].netTotalMinor).toBe(77_000);
  });

  it("«الارتفاع ١٥٪» يختفي حين تسوّى الفاتورتان بصافيهما", () => {
    const june17 = reconcileInvoiceLines([mk(7_700, 115_500)], 115_500);
    const june21 = reconcileInvoiceLines([mk(8_855, 88_550), mk(8_855, 88_550)], 154_000);
    expect(june21.lines[0].effectiveUnitMinor).toBe(june17.lines[0].effectiveUnitMinor);
  });

  it("سعر القائمة والخصم يردّان معاً", () => {
    const line = { effectiveUnitMinor: 8_855, netTotalMinor: 88_550, listUnitMinor: 16_100, discountMinor: 72_450, basis: "DISCOUNTED" as const };
    const r = reconcileInvoiceLines([line], 77_000);
    expect(r.verdict).toBe("WAS_VAT_INCLUSIVE");
    expect(r.lines[0].listUnitMinor).toBe(14_000);
    expect(r.lines[0].discountMinor).toBe(63_000);
    expect(r.lines[0].basis).toBe("DISCOUNTED");
  });

  it("بلا صاف معلوم لا يدّعى تحقّق", () => {
    expect(reconcileInvoiceLines([mk(100, 100)], null).verdict).toBe("UNVERIFIED");
    expect(reconcileInvoiceLines([mk(100, 100)], 0).verdict).toBe("UNVERIFIED");
  });

  it("المجموع الذي لا يوافق الصافي ولا الشامل يبقى غير محقّق ولا يعدّل", () => {
    const r = reconcileInvoiceLines([mk(100, 5_000)], 9_000);
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.lines[0].netTotalMinor).toBe(5_000);
  });

  it("بلا بنود لا شيء يسوّى", () => {
    expect(reconcileInvoiceLines([], 1_000).lines).toHaveLength(0);
  });
});

describe("parseLineQuantity — الكمّيّة كما كتبت، والمجهول ليس واحداً", () => {
  it("الأرقام العربيّة والفاصلة العشريّة", () => {
    expect(parseLineQuantity("٣")).toBe("3");
    expect(parseLineQuantity("٢٫٥")).toBe("2.5");
    expect(parseLineQuantity("2,5")).toBe("2.5");
    expect(parseLineQuantity("1,200")).toBe("1200");
    expect(parseLineQuantity("5 كيلو")).toBe("5");
  });
  it("ما لا يقرأ رقماً واحداً يبقى مجهولاً", () => {
    expect(parseLineQuantity(undefined)).toBeNull();
    expect(parseLineQuantity("")).toBeNull();
    expect(parseLineQuantity("0")).toBeNull();
    expect(parseLineQuantity("-2")).toBeNull();
    expect(parseLineQuantity("12 × 500")).toBeNull();
    expect(parseLineQuantity("كرتون")).toBeNull();
  });
});

describe("الكرتونُ مكانَ الحبّة — قراءاتُ نادك الحقيقيّة", () => {
  /* «حبّاتُ الكرتون 6» في خانة الكمّيّة، والمجموعُ شاملٌ الضريبة، وسعرُ الحبّة ٩٫١٠ */
  const read = (quantity: string, unitPrice: string, lineTotal: string, usual: number | null = null, subtotal: number | null = null) =>
    resolveReadLines([{ description: "MLK FF 1.75L", quantity, unitPrice, lineTotal }], subtotal, () => usual)[0];

  it("سعران في الخانة («54.60 / 9.10»): الأصغرُ للحبّة والكمّيّةُ من المجموع", () => {
    expect(unitPriceCandidates("54.60 / 9.10")).toEqual([5_460, 910]);
    expect(read("6", "54.60 / 9.10", "146.51")).toMatchObject({ qtyText: "14", effectiveUnitMinor: 910, netTotalMinor: 12_740, basis: "PACK_QTY" });
    expect(read("6", "54.60 / 9.10", "10.47")).toMatchObject({ qtyText: "1", effectiveUnitMinor: 910, netTotalMinor: 910 });
  });

  it("سعرُ الكرتون والكمّيّةُ حبّاتُه: الكرتون ÷ حبّاته سعرُ الحبّة", () => {
    expect(read("6", "54.60", "188.37")).toMatchObject({ qtyText: "18", effectiveUnitMinor: 910, basis: "PACK_QTY" });
    expect(read("6", "54.60", "136.50")).toMatchObject({ qtyText: "15", effectiveUnitMinor: 910, netTotalMinor: 13_650 });
    expect(read("6", "54.60", "10.47", 910)).toMatchObject({ qtyText: "1", effectiveUnitMinor: 910 });
  });

  it("سعرُ الحبّة والمجموعُ أكبر من الضرب: الكمّيّةُ هي الخطأ", () => {
    expect(read("6", "9.10", "156.98")).toMatchObject({ qtyText: "15", effectiveUnitMinor: 910, netTotalMinor: 13_650 });
  });

  it("بلا سعرٍ مقروء: بالسعر المعتاد للصنف وحده — وبلا معتادٍ يبقى كما كان", () => {
    expect(read("6", "", "156.98", 910)).toMatchObject({ qtyText: "15", effectiveUnitMinor: 910, basis: "PACK_QTY" });
    expect(read("6", "", "156.98", null)).toMatchObject({ qtyText: "6", basis: "DERIVED" });
    /* المجموعُ لا يقسم على المعتاد: لعلّ السعر تغيّر — لا يُخترع عدد */
    expect(read("6", "", "150.00", 910)).toMatchObject({ qtyText: "6", basis: "DERIVED" });
  });

  it("ما يستقيم بالكمّيّة المقروءة لا يُمسّ", () => {
    expect(read("6", "9.10", "54.60")).toMatchObject({ qtyText: "6", basis: "CONSISTENT" });
    expect(read("6", "54.60 / 9.10", "54.60")).toMatchObject({ qtyText: "6", effectiveUnitMinor: 910, basis: "CONSISTENT" });
  });

  it("الخصمُ الحقيقيّ لا يصير كرتوناً: عشرةٌ بمئة بخصم ١٠٪ تبقى عشرة", () => {
    expect(packQuantity(10, [10_000], 90_000, null)).toBeNull();
    const line = resolveReadLines([{ description: "بن", quantity: "10", unitPrice: "100", lineTotal: "900" }], null)[0];
    expect(line).toMatchObject({ qtyText: "10", basis: "DISCOUNTED" });
  });

  it("سعران لا يتضاعفان لا يُقرآن", () => {
    expect(unitPriceCandidates("54.60 / 9.00")).toEqual([]);
    expect(unitPriceCandidates("12 x 500")).toEqual([]);
  });
});

describe("الكرتونُ مكانَ الحبّة — ما بقي", () => {
  const read = (quantity: string, unitPrice: string, lineTotal: string, usual: number | null) =>
    resolveReadLines([{ description: "MLK LF 1.75L", quantity, unitPrice, lineTotal }], null, () => usual)[0];

  it("سعرُ الحبّة المعتاد والمجموعُ حبّةٌ بضريبتها: حبّةٌ لا خصمُ ٨٠٪", () => {
    expect(read("6", "9.10", "10.47", 910)).toMatchObject({ qtyText: "1", effectiveUnitMinor: 910, basis: "PACK_QTY" });
    /* بلا معتادٍ يُعرف لا يُحسم */
    expect(read("6", "9.10", "10.47", null).basis).toBe("DISCOUNTED");
    /* خصمٌ حقيقيّ عند مورّدٍ سعرُه المعتاد مئة لا يصير «تسعاً» */
    expect(packQuantity(10, [10_000], 90_000, 10_000)).toBeNull();
  });

  it("بلا سعرٍ والكمّيّةُ صحيحة: المعتادُ يحسم أنّ المجموعَ شاملٌ الضريبة", () => {
    expect(read("1", "", "10.47", 910)).toMatchObject({ qtyText: "1", effectiveUnitMinor: 910, netTotalMinor: 910, basis: "TOTAL_INCLUDES_VAT" });
  });
});

describe("الخصمُ الحقيقيّ عند مورّدٍ معروف السعر", () => {
  it("غاناش «4 × 100 = 200»: أربعٌ بنصف السعر لا حبّتان", () => {
    expect(packQuantity(4, [10_000], 20_000, 10_000)).toBeNull();
    const line = resolveReadLines([{ description: "Cheesecake Date Brulee L", quantity: "4.00", unitPrice: "100.00", lineTotal: "200.00" }], 59_600, () => 10_000)[0];
    expect(line).toMatchObject({ qtyText: "4", effectiveUnitMinor: 5_000, basis: "DISCOUNTED" });
  });
});
