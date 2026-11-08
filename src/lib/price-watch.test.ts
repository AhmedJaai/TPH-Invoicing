import { describe, expect, it } from "vitest";
import { gapReason, isRealMove, itemIdentity, movesAtReview, needsLineCheck, supplierPriceDriftBp, trackPrices, type PriceLine } from "./price-watch";
import { normalizeItem } from "./items";

const TODAY = "2026-11-09";
let seq = 0;
const line = (day: string, unitMinor: number, o: Partial<PriceLine> = {}): PriceLine => {
  const description = o.description ?? "بن";
  return {
    supplierId: "s1", normalized: normalizeItem(description), description,
    invoiceId: o.invoiceId ?? `inv-${day}-${seq++}`, invoiceNumber: null, day, unitMinor,
    qtyMilli: 1000, basis: "CONSISTENT", ...o,
  };
};
const one = (lines: PriceLine[]) => {
  const items = trackPrices(lines, TODAY);
  expect(items).toHaveLength(1);
  return items[0];
};

describe("التغيّر يُصدَّق بفاتورتين", () => {
  it("سعرٌ جديد في فاتورةٍ واحدة ينتظر — لا «ارتفاع»", () => {
    const i = one([line("2026-09-01", 1000), line("2026-10-01", 1000), line("2026-11-01", 1100)]);
    expect(i.state.kind).toBe("UNCONFIRMED");
    expect(isRealMove(i.state)).toBe(false);
    /* المعتادُ يبقى معياراً حتى يتأكّد الجديد */
    expect(i.expectedMinor).toBe(1000);
  });

  it("تكرّر في فاتورتين: تغيّرٌ مؤكَّد من المعتاد", () => {
    const i = one([line("2026-08-01", 1000), line("2026-09-01", 1000), line("2026-10-01", 1100), line("2026-11-01", 1100)]);
    expect(i.state).toMatchObject({ kind: "MOVED", fromMinor: 1000, toMinor: 1100, deltaBp: 1000, sinceDay: "2026-10-01", confirmations: 2, reason: null });
    expect(i.expectedMinor).toBe(1100);
  });

  it("قراءةٌ شاذّة بين فاتورتين بالسعر المعتاد تُتجاهل (دولتشي «٧٠» بين ١٤ و١٤)", () => {
    const i = one([line("2026-10-31", 1400), line("2026-11-03", 7000), line("2026-11-04", 1400)]);
    expect(i.state.kind).toBe("STABLE");
    expect(i.trail).toEqual([1400, 1400]);
    expect(i.readings.find((r) => r.unitMinor === 7000)?.stray).toBe(true);
  });

  it("المعتادُ قبل التغيّر هو الأكثر تكراراً لا آخرُ سطر (ترافل المانجو ١٢ ثمّ ١١٫٥٠)", () => {
    const i = one([
      line("2026-09-02", 1200), line("2026-09-05", 1200), line("2026-10-05", 1200),
      line("2026-10-28", 1150), line("2026-10-31", 1150), line("2026-11-03", 5750), line("2026-11-04", 1150),
    ]);
    expect(i.state).toMatchObject({ kind: "MOVED", fromMinor: 1200, toMinor: 1150, confirmations: 3 });
  });

  it("دون ٣٪ تقريبٌ لا حركة", () => {
    expect(one([line("2026-10-01", 1565), line("2026-11-01", 1522), line("2026-11-02", 1522)]).state.kind).toBe("STABLE");
  });

  it("قفزةٌ بقدر الضريبة لم تتكرّر قراءةٌ لا سعر (ألبرو ١٥٫٦٥ ثمّ ١٨ ثمّ ١٥٫٢٢)", () => {
    const i = one([line("2026-07-01", 1565), line("2026-07-07", 1800), line("2026-07-21", 1478), line("2026-08-01", 1522), line("2026-09-01", 1522)]);
    expect(i.state.kind).toBe("STABLE");
  });
});

describe("ما يفسّره غيرُ السعر يُسمّى", () => {
  it("الضريبة: ×١٫١٥ قراءةٌ شاملة لا ارتفاع", () => {
    expect(gapReason(28_700, 33_000)).toBe("VAT");
    expect(gapReason(21_500, 18_750)).toBe("VAT");
    expect(gapReason(1000, 1100)).toBeNull();
  });

  it("ضعفان فأكثر: الكمّيّة أو الوحدة — والمجموعُ مكانَ الحبّة", () => {
    expect(gapReason(14_500, 29_000)).toBe("UNIT");
    expect(gapReason(303, 152)).toBe("UNIT");
    expect(gapReason(15_000, 1_150)).toBe("UNIT");
    expect(gapReason(522, 696)).toBeNull();
  });

  it("علب البرجر ١٥٠ ثمّ ١١٫٥٠: «راجع البند» لا انخفاض ٩٢٪", () => {
    const i = one([line("2026-07-02", 15_000), line("2026-08-18", 15_000), line("2026-10-27", 1_150)]);
    expect(i.state).toMatchObject({ kind: "UNCONFIRMED", reason: "UNIT" });
    expect(needsLineCheck(i.state)).toBe(true);
    expect(isRealMove(i.state)).toBe(false);
  });
});

describe("سعران في فاتورةٍ واحدة صنفان باسمٍ واحد", () => {
  it("غاناش: ١٠٠ و١٣٢ معاً في الفاتورة نفسها لا «+٣٢٪»", () => {
    const i = one([
      line("2026-05-25", 10_000, { invoiceId: "a" }), line("2026-05-25", 13_200, { invoiceId: "a" }),
      line("2026-05-29", 10_000), line("2026-06-01", 10_000),
      line("2026-06-04", 13_200), line("2026-06-10", 13_200),
    ]);
    expect(i.state.kind).toBe("MIXED");
    expect(i.expectedMinor).toBeNull();
    expect(i.readings.find((r) => r.invoiceId === "a")?.unitMinor).toBeNull();
  });

  it("سطرٌ لا يستقيم ضربُه أو بلا كمّيّة لا يُبنى عليه سعر", () => {
    const i = one([line("2026-10-01", 1000), line("2026-10-10", 1000), line("2026-11-01", 9000, { basis: "INCONSISTENT" })]);
    expect(i.state.kind).toBe("STABLE");
  });
});

describe("صيغُ الاسم الواحد — بالدليل القاطع وحده", () => {
  const groups = (names: string[], invoiceOf: (n: string, i: number) => string = (_n, i) => `inv${i}`) => {
    const id = itemIdentity(names.map((n, i) => ({ normalized: normalizeItem(n), invoiceId: invoiceOf(n, i) })));
    return new Set(id.values()).size;
  };

  it("الكلماتُ نفسُها بترتيبٍ آخر، ورمزُ الصنف في أوّله أو آخره", () => {
    expect(groups(["1001 ترافل المانجو", "ترافل المانجو", "ترافل المانجو 1001"])).toBe(1);
    expect(groups(["[100051] Blend Fusion – Medium Roast 1 KG / بلند فيوجن 1 – وسط كجم", "Blend Fusion – Medium Roast 1 KG / بلند فيوجن – وسط 1 كجم"])).toBe(1);
  });

  it("المسافةُ التي شقّت الكلمة (دولت شي)", () => {
    expect(groups(["دولتشي", "دولت شي"])).toBe(1);
  });

  it("الاسمُ الإنجليزيّ نفسُه والعربيُّ مقروءٌ بخطأ", () => {
    expect(groups(["Alpro Barista Almond 1L / البرو باريستا اللوز", "Alpro Barista Almond 1L / ألبرو باريس تا اللوز 1 لتر"])).toBe(1);
  });

  it("رمزُ SKU نفسُه يجمع ما اختلف وصفُه", () => {
    expect(groups(["ZFG0238 Ceasar Wrap Z2", "التفاف سيزار ZFG0238"])).toBe(1);
  });

  it("لا يجمع ما اختلفت أرقامُه أو كان رموزاً لا كلمات", () => {
    expect(groups(["Alpro Barista Coconut Milk 1L", "Alpro Barista Coconut Milk 8x1L"])).toBe(2);
    expect(groups(["حبوب باسفيك BK-02 V019 CF", "فنجان BK-02 V019 CF"])).toBe(2);
    expect(groups(["اغطيه 7 اونز اسود 1000", "اغطيه 8 اونز اسود 1000"])).toBe(2);
    expect(groups(["عنب", "كولومبي عنب"])).toBe(2);
  });

  it("صيغتان في فاتورةٍ واحدة بندين لا تُجمعان", () => {
    expect(groups(["ترافل المانجو", "1001 ترافل المانجو"], () => "same")).toBe(2);
  });

  it("السعرُ يُتتبّع عبر الصيغ", () => {
    const i = one([
      line("2026-09-01", 1200, { description: "1001 ترافل المانجو" }),
      line("2026-10-01", 1200, { description: "ترافل المانجو" }),
      line("2026-11-01", 1150, { description: "ترافل المانجو 1001" }),
      line("2026-11-05", 1150, { description: "1001 ترافل المانجو" }),
    ]);
    expect(i.variants).toHaveLength(3);
    expect(i.state).toMatchObject({ kind: "MOVED", fromMinor: 1200, toMinor: 1150 });
  });
});

describe("المراجعة تقارن بالمعتاد", () => {
  const history = [line("2026-09-01", 1000), line("2026-10-01", 1000), line("2026-11-01", 1300)];

  it("بالسعر المعتاد لا بآخر قراءةٍ لم تتأكّد", () => {
    const [m] = movesAtReview([{ description: "بن", normalized: "بن", unitMinor: 1100 }], history, TODAY);
    expect(m).toMatchObject({ wasMinor: 1000, nowMinor: 1100, deltaBp: 1000, reason: null });
  });

  it("الفرقُ قدرَ الضريبة يُقال سببُه", () => {
    const [m] = movesAtReview([{ description: "بن", normalized: "بن", unitMinor: 1150 }], history.slice(0, 2), TODAY);
    expect(m.reason).toBe("VAT");
  });

  it("السعرُ المعتاد لا يُقال عنه شيء، والصنفُ الجديد لا يُقارن", () => {
    expect(movesAtReview([{ description: "بن", normalized: "بن", unitMinor: 1010 }], history.slice(0, 2), TODAY)).toEqual([]);
    expect(movesAtReview([{ description: "سكر", normalized: "سكر", unitMinor: 500 }], history, TODAY)).toEqual([]);
  });

  it("صيغةٌ أخرى للاسم تُقارن بصنفها", () => {
    const h = [line("2026-09-01", 1200, { description: "1001 ترافل المانجو" }), line("2026-10-01", 1200, { description: "1001 ترافل المانجو" })];
    const [m] = movesAtReview([{ description: "ترافل المانجو", normalized: normalizeItem("ترافل المانجو"), unitMinor: 1300 }], h, TODAY);
    expect(m).toMatchObject({ wasMinor: 1200, nowMinor: 1300 });
  });
});

describe("تغيّرُ أسعار المورّد في مجملها", () => {
  it("موزونٌ بالأصناف لا بمتوسّط السطور، وبلا ما يفسّره غيرُ السعر", () => {
    const items = trackPrices([
      line("2026-09-01", 1000, { description: "بن" }), line("2026-10-01", 1100, { description: "بن" }), line("2026-11-01", 1100, { description: "بن" }),
      line("2026-09-01", 15_000, { description: "علب" }), line("2026-10-01", 1_150, { description: "علب" }),
    ], TODAY);
    /* البنُّ +١٠٪ بثلاث فواتير، والعلبُ سعرُها المعتاد لم يتغيّر (القراءةُ الشاذّة لا تُحسب): (١٠٠٠×٣ + ٠×٢) ÷ ٥ */
    expect(supplierPriceDriftBp(items)).toBe(600);
  });

  it("بلا صنفٍ اشتُري مرّتين: غيرُ مقيَّم لا صفر", () => {
    expect(supplierPriceDriftBp(trackPrices([line("2026-09-01", 1000)], TODAY))).toBeNull();
  });
});
