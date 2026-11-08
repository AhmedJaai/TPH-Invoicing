import { describe, expect, it } from "vitest";
import { normalizeItem } from "./items";
import { priceMovesAtReview, priceObjection } from "./price-at-review";
import type { PriceLine } from "./price-watch";

const TODAY = "2026-11-09";
/* سعرٌ معتاد: فاتورتان بالسعر نفسه عند المورّد */
const usual = (pairs: [string, number][]): PriceLine[] =>
  pairs.flatMap(([name, unitMinor]) => ["2026-08-01", "2026-09-01"].map((day) => ({
    supplierId: "s1", normalized: normalizeItem(name), description: name, invoiceId: `${day}`, invoiceNumber: null,
    day, unitMinor, qtyMilli: 1000, basis: "CONSISTENT",
  })));
const none = new Map<string, string>();
const at = (lines: { description: string; quantity?: string; unitPrice?: string; lineTotal?: string }[], history: PriceLine[], subtotal: number | null = null, aliases = none) =>
  priceMovesAtReview(lines.map((l) => ({ quantity: "1", ...l })), subtotal, history, aliases, TODAY);

describe("مقارنة السعر لحظة المراجعة", () => {
  it("الارتفاع يقال بنقاط الأساس من السعر المعتاد عند المورّد نفسه", () => {
    const [m] = at([{ description: "حليب طازج ٢ لتر", unitPrice: "10.80" }], usual([["حليب طازج ٢ لتر", 1_000]]));
    expect(m).toMatchObject({ nowMinor: 1_080, wasMinor: 1_000, deltaBp: 800, wasDay: "2026-09-01", reason: null });
  });

  it("يقارن ما دُفع بعد الخصم لا سعرَ القائمة (أفال: ١٤٠ في الخانة، والمدفوع ٧٧)", () => {
    const moves = at([{ description: "بلند فيوجن", quantity: "10", unitPrice: "140", lineTotal: "770" }], usual([["بلند فيوجن", 7_700]]));
    expect(moves).toEqual([]);
  });

  it("بنودٌ قُرئت شاملةً الضريبة تُسوّى بصافي الفاتورة قبل المقارنة", () => {
    const moves = at([{ description: "سكر", unitPrice: "11.50", lineTotal: "11.50" }], usual([["سكر", 1_000]]), 1_000);
    expect(moves).toEqual([]);
  });

  it("الفرقُ بقدر الضريبة بلا مرساة يُقال سببُه ولا يُعترض به", () => {
    const [m] = at([{ description: "سكر", unitPrice: "11.50" }], usual([["سكر", 1_000]]));
    expect(m.reason).toBe("VAT");
  });

  it("المجموعُ مكانَ الحبّة: «راجع البند» لا «ارتفع ٥٠٠٪»", () => {
    const [m] = at([{ description: "دولتشي", quantity: "1", unitPrice: "70" }], usual([["دولتشي", 1_400]]));
    expect(m.reason).toBe("UNIT");
  });

  it("دون ٣٪ تقريب لا حركة، وما لا سابقة له أو بلا كمّيّة لا يقال عنه شيء", () => {
    const known = usual([["سكر", 1_000]]);
    expect(at([{ description: "سكر", unitPrice: "10.20" }], known)).toEqual([]);
    expect(at([{ description: "سكر", unitPrice: "" }], known)).toEqual([]);
    expect(at([{ description: "ملح", unitPrice: "50" }], known)).toEqual([]);
    expect(at([{ description: "سكر", quantity: "", unitPrice: "50" }], known)).toEqual([]);
  });

  it("الصيغةُ التي أقرّها إنسانٌ تُقارن باسمها المقيَّد", () => {
    const aliases = new Map([[normalizeItem("كولومي عنب"), normalizeItem("كولومبي عنب")]]);
    const [m] = at([{ description: "كولومي عنب", unitPrice: "170" }], usual([["كولومبي عنب", 15_500]]), null, aliases);
    expect(m).toMatchObject({ wasMinor: 15_500, nowMinor: 17_000 });
  });

  it("الارتفاعُ الحقيقيّ أوّلاً، ثمّ ما يحتاج مراجعة", () => {
    const moves = at(
      [{ description: "ملح", unitPrice: "30" }, { description: "سكر", unitPrice: "11" }, { description: "بنّ", unitPrice: "120" }],
      usual([["سكر", 1_000], ["بنّ", 10_000], ["ملح", 1_000]]),
    );
    expect(moves.map((m) => m.description)).toEqual(["بنّ", "سكر", "ملح"]);
  });

  it("رسالة الاعتراض تذكر ما ارتفع فعلاً وحده بسعريه", () => {
    const moves = at(
      [{ description: "سكر", unitPrice: "11" }, { description: "ملح", unitPrice: "5" }, { description: "بنّ", unitPrice: "300" }],
      usual([["سكر", 1_000], ["ملح", 1_000], ["بنّ", 10_000]]),
    );
    const text = priceObjection("المراعي", moves, (m) => (m / 100).toFixed(2), (d) => d);
    expect(text).toContain("سكر: 11.00 (كان 10.00 في 2026-09-01)");
    expect(text).not.toContain("ملح");
    expect(text).not.toContain("بنّ");
  });
});
