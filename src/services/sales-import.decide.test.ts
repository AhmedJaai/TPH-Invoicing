import { describe, expect, it } from "vitest";
import { decideLines } from "./sales-import.service";
import type { ParsedSale, ParsedSaleLine } from "@/lib/sales/file-import";

/**
 * قرارُ الأسطر في الذاكرة — بلا قاعدة.
 *
 * الكتابةُ دفعةٌ بعده؛ فما يُدرَج وما يُحدَّث وما يُلغى يُختبَر هنا بعينه.
 */
const line = (sku: string, over: Partial<ParsedSaleLine> = {}): ParsedSaleLine => ({
  externalId: `${sku}#P#1`, productExternalId: sku, name: sku, category: null,
  quantityMilli: 1000, unitPriceMinor: 1800, lineTotalMinor: 1800,
  sourceStatus: "Done", isRefund: false, isVoid: false, isComplimentary: false,
  isModifier: false, parentExternalId: null, parentLineExternalId: null, modifiers: null,
  sourceUnitCostMinor: null, contentHash: `h-${sku}`, rowNumbers: [2],
  ...over,
});

const sale = (externalId: string, lines: ParsedSaleLine[]): ParsedSale => ({
  externalId, orderStatus: "Done", businessDate: "2026-09-13", soldAt: new Date(Date.UTC(2026, 8, 13, 12)),
  branchLabel: null, grossMinor: 0, discountMinor: 0, refundMinor: 0, vatMinor: 0, netMinor: 0,
  orderCount: 1, isVoid: false, lines,
});

const prior = (sku: string, over: Record<string, unknown> = {}) => [`${sku}#P#1`, {
  id: `id-${sku}`, externalId: `${sku}#P#1`, contentHash: `h-${sku}`, sourceStatus: "Done",
  quantity: "1.000", isComplimentary: false, isModifier: false, parentLineExternalId: null, ...over,
}] as const;

describe("decideLines", () => {
  it("الجديدُ يُدرَج، والمطابقُ لا يُكتَب، والمتغيّرُ يُحدَّث ويُعلَن", () => {
    const out = decideLines("s1", sale("FDX:1", [
      line("a"), line("b"), line("c", { contentHash: "h-c2", sourceStatus: "Void", isVoid: true }),
    ]), new Map(), new Map([prior("b"), prior("c")]));
    expect(out.fresh.map((l) => l.externalId)).toEqual(["a#P#1"]);
    expect(out.changed.map((l) => l.id)).toEqual(["id-c"]);
    expect(out.revised).toHaveLength(1);
    expect(out.removed).toEqual([]);
  });

  it("سطرُ طلبٍ غاب عن تصديرٍ أحدث يُلغى", () => {
    const out = decideLines("s1", sale("FDX:1", [line("a")]), new Map(), new Map([prior("a"), prior("b")]));
    expect(out.removed).toEqual(["id-b"]);
    expect(out.revised[0].now).toContain("غاب عن التصدير");
  });

  it("وما أُلغي من قبل لا يُعلَن ثانيةً", () => {
    const out = decideLines("s1", sale("FDX:1", [line("a")]), new Map(),
      new Map([prior("a"), prior("b", { sourceStatus: "REMOVED_IN_LATER_EXPORT" })]));
    expect(out.removed).toEqual([]);
  });

  it("مزيجُ منتجاتٍ مرشَّحٌ (صنفٌ من خمسة) لا يُلغي بقيّةَ اليوم", () => {
    const out = decideLines("s1", sale("PMIX:b:2026-09-13", [line("a")]), new Map(),
      new Map([prior("a"), prior("b"), prior("c"), prior("d"), prior("e")]));
    expect(out.removed).toEqual([]);
    expect(out.keptDespiteAbsence).toBe(4);
  });

  it("ومزيجٌ مصحَّحٌ نقص صنفاً من خمسة يُلغيه", () => {
    const out = decideLines("s1", sale("PMIX:b:2026-09-13", [line("a"), line("b"), line("c"), line("d")]), new Map(),
      new Map([prior("a"), prior("b"), prior("c"), prior("d"), prior("e")]));
    expect(out.removed).toEqual(["id-e"]);
    expect(out.keptDespiteAbsence).toBe(0);
  });

  it("ما نشتقّه نحن (سطرُ الأصل، المجانيّ) يُملأ بلا إعلان مراجعة", () => {
    const mod = line("m", { isModifier: true, parentExternalId: "a", parentLineExternalId: "a#P#1" });
    const out = decideLines("s1", sale("FDX:1", [line("a"), mod]), new Map(),
      new Map([prior("a"), prior("m", { isModifier: true })]));
    expect(out.changed.map((l) => l.id)).toEqual(["id-m"]);
    expect(out.revised).toEqual([]);
    expect(out.byRow.get(2)?.status).toBe("DUPLICATE");
  });
});
