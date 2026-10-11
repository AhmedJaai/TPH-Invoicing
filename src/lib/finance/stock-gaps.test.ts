import { describe, expect, it } from "vitest";
import { recurringGaps, type MonthGap } from "./stock-gaps";

const g = (month: string, oursMinor: number | null, witnessMinor: number | null = null, productId = "guji"): MonthGap => ({ month, productId, name: productId, oursMinor, witnessMinor });
const MONTHS = ["2026-09", "2026-08", "2026-07"];

describe("فرقٌ يتكرّر", () => {
  it("شهران متتاليان فوق الحدّ نمط", () => {
    const [r] = recurringGaps([g("2026-09", 20_000), g("2026-08", 18_000), g("2026-07", 1_000)], MONTHS);
    expect(r).toMatchObject({ kind: "SHORTAGE", months: ["2026-09", "2026-08"], totalMinor: 38_000, byWitness: false });
  });
  it("شهرٌ واحد ليس نمطاً، وفرقٌ قديمٌ انقطع ليس قائماً", () => {
    expect(recurringGaps([g("2026-09", 20_000), g("2026-08", 5_000)], MONTHS)).toEqual([]);
    expect(recurringGaps([g("2026-09", 1_000), g("2026-08", 20_000), g("2026-07", 20_000)], MONTHS)).toEqual([]);
  });
  it("نقصٌ ثمّ زيادة ليسا نمطاً واحداً", () => {
    expect(recurringGaps([g("2026-09", 20_000), g("2026-08", -20_000)], MONTHS)).toEqual([]);
  });
  it("السالبُ بفواتيرنا «فاتورةٌ ناقصة؟»", () => {
    const [r] = recurringGaps([g("2026-09", -30_000), g("2026-08", -16_000)], MONTHS);
    expect(r.kind).toBe("OVER_AVAILABLE");
    expect(r.totalMinor).toBe(46_000);
  });
  it("شاهدُ فودكس يُقبَل نقصاً ويُعلَّم، ولا يُقبَل زيادة", () => {
    const [r] = recurringGaps([g("2026-09", null, 20_000), g("2026-08", null, 20_000)], MONTHS);
    expect(r).toMatchObject({ kind: "SHORTAGE", byWitness: true });
    expect(recurringGaps([g("2026-09", null, -20_000), g("2026-08", null, -20_000)], MONTHS)).toEqual([]);
  });
  it("شهرٌ غير معروفٍ يقطع السلسلة — المجهولُ ليس صفراً ولا فرقاً", () => {
    expect(recurringGaps([g("2026-09", 20_000), g("2026-07", 20_000)], MONTHS)).toEqual([]);
  });
});
