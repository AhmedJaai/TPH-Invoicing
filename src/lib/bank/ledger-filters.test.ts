import { describe, expect, it } from "vitest";
import { hasLedgerFilters, ledgerFilterParams, minorToInput, parseLedgerFilters } from "./ledger-filters";

describe("مرشِّحاتُ سجلّ البنك", () => {
  it("بلا شيءٍ لا مرشِّح", () => {
    const f = parseLedgerFilters({});
    expect(hasLedgerFilters(f)).toBe(false);
    expect(ledgerFilterParams(f)).toEqual({});
  });

  it("المدى بالتاريخ والمبلغ يُقرأ — والمبلغُ هللات", () => {
    const f = parseLedgerFilters({ from: "2026-10-01", to: "2026-10-31", min: "1,000", max: "2500.5" });
    expect(f).toMatchObject({ fromDay: "2026-10-01", toDay: "2026-10-31", minMinor: 100_000, maxMinor: 250_050 });
    expect(hasLedgerFilters(f)).toBe(true);
  });

  it("المدى المقلوب يُعدَل ولا يُرجع «لا نتائج»", () => {
    const f = parseLedgerFilters({ from: "2026-10-31", to: "2026-10-01", min: "900", max: "100" });
    expect([f.fromDay, f.toDay]).toEqual(["2026-10-01", "2026-10-31"]);
    expect([f.minMinor, f.maxMinor]).toEqual([10_000, 90_000]);
  });

  it("ما لا يُفهم يسقط ولا يُخمَّن", () => {
    const f = parseLedgerFilters({ from: "2026-02-31", to: "أمس", min: "abc", max: "-5", cat: "DROP TABLE", state: "x" });
    expect(hasLedgerFilters(f)).toBe(false);
  });

  it("الصفرُ حدٌّ أدنى مقصود لا مجهول", () => {
    expect(parseLedgerFilters({ min: "0" }).minMinor).toBe(0);
  });

  it("التصنيفُ والحالُ من قائمتهما وحدها", () => {
    const f = parseLedgerFilters({ cat: "SUPPLIER", state: "pending" });
    expect(f.category).toBe("SUPPLIER");
    expect(f.state).toBe("pending");
  });

  it("الذهابُ والإيابُ بالعنوان يعطيان المرشِّحَ نفسه", () => {
    const f = parseLedgerFilters({ from: "2026-09-01", min: "12.05", cat: "RENT", state: "matched" });
    expect(parseLedgerFilters(ledgerFilterParams(f))).toEqual(f);
  });

  it("المبلغُ في الحقل بلا عشريٍّ عائم", () => {
    expect(minorToInput(245_000)).toBe("2450");
    expect(minorToInput(245_005)).toBe("2450.05");
  });
});
