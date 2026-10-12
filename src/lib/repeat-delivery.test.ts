import { describe, expect, it } from "vitest";
import { deliverySignature, findRepeatDeliveries, usualGapDays, type DeliveryInvoice } from "./repeat-delivery";

const coffee = (qty = 5000) => [
  { key: "fusion", qtyMilli: qty }, { key: "brazil", qtyMilli: qty }, { key: "margo", qtyMilli: qty }, { key: "guji", qtyMilli: qty },
];
const inv = (number: string, day: string, totalMinor: number, lines = coffee(), supplierId = "aval"): DeliveryInvoice =>
  ({ id: number, supplierId, number, day, totalMinor, lines });

/** أفال كما كانت: توريدٌ أسبوعيّ، والملغاةُ وبديلتُها بينهما يومان. */
const AVAL = [
  inv("00054", "2026-07-13", 166_031, [{ key: "margo", qtyMilli: 15_000 }]),
  inv("00064", "2026-07-19", 132_825, [{ key: "brazil", qtyMilli: 15_000 }]),
  inv("00073", "2026-08-03", 99_619, [{ key: "margo", qtyMilli: 5000 }, { key: "fusion", qtyMilli: 5000 }]),
  inv("00080", "2026-08-13", 199_870),
  inv("00084", "2026-08-15", 194_494),
  inv("00106", "2026-08-27", 194_494),
];

describe("توريدٌ قُيِّد مرّتين", () => {
  it("يجد الملغاةَ وبديلتَها: البنودُ نفسُها بعد يومين وإن اختلف السعر", () => {
    const pairs = findRepeatDeliveries(AVAL);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].first.number, pairs[0].second.number]).toEqual(["00080", "00084"]);
    expect(pairs[0].gapDays).toBe(2);
    expect(pairs[0].atStakeMinor).toBe(194_494);
  });

  it("الطلبُ نفسُه بعد اثني عشر يوماً توريدٌ آخر", () => {
    expect(findRepeatDeliveries(AVAL.filter((i) => i.number !== "00080"))).toEqual([]);
  });

  it("اختلافُ كمّيّةٍ واحدة يُخرجها", () => {
    const other = [...coffee().slice(1), { key: "fusion", qtyMilli: 3000 }];
    expect(findRepeatDeliveries(AVAL.map((i) => (i.number === "00084" ? { ...i, lines: other } : i)))).toEqual([]);
  });

  it("مورّدٌ يورّد كلَّ يومٍ الطلبَ نفسَه لا يُسأل عنه", () => {
    const daily = ["01", "02", "03", "04", "05", "06"].map((d) => inv(`D${d}`, `2026-09-${d}`, 14_000, [{ key: "bread", qtyMilli: 20_000 }], "bakery"));
    expect(findRepeatDeliveries(daily)).toEqual([]);
  });

  it("ما لم تُقرأ كمّيّتُه أو لا بنودَ له لا يُقارَن", () => {
    const blind = AVAL.map((i) => (i.number === "00084" ? { ...i, lines: [{ key: "fusion", qtyMilli: null }] } : i));
    expect(findRepeatDeliveries(blind)).toEqual([]);
    expect(deliverySignature([])).toBeNull();
  });

  it("ترتيبُ السطور وتقسيمُ الصنف على سطرين لا يغيّران البصمة", () => {
    expect(deliverySignature([{ key: "b", qtyMilli: 2000 }, { key: "a", qtyMilli: 1000 }, { key: "b", qtyMilli: 3000 }]))
      .toBe(deliverySignature([{ key: "a", qtyMilli: 1000 }, { key: "b", qtyMilli: 5000 }]));
  });

  it("الإيقاعُ وسيطٌ لا متوسّط، ولا يُعرف بأقلّ من أربع فواتير", () => {
    expect(usualGapDays(["2026-08-01", "2026-08-02", "2026-08-09"])).toBeNull();
    expect(usualGapDays(AVAL.map((i) => i.day))).toBe(10);
  });
});
