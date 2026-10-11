import { describe, expect, it } from "vitest";
import { buildOwnerAccount, signedMinor, type OwnerEntry } from "./owner-account";

const e = (id: string, day: string, kind: OwnerEntry["kind"], amountMinor: number): OwnerEntry =>
  ({ id, day, kind, amountMinor, label: id, href: "/bank" });

describe("buildOwnerAccount", () => {
  it("ما دفعه وأدخله له، وما أخذه عليه", () => {
    expect(signedMinor({ kind: "PAID_FOR_CAFE", amountMinor: 100 })).toBe(100);
    expect(signedMinor({ kind: "PUT_IN", amountMinor: 100 })).toBe(100);
    expect(signedMinor({ kind: "TOOK_OUT", amountMinor: 100 })).toBe(-100);
  });

  it("الرصيدُ الجاري بترتيب الأيّام، والعرضُ الأحدثُ أوّلاً", () => {
    const a = buildOwnerAccount([
      e("c", "2026-03-10", "TOOK_OUT", 5000_00),
      e("a", "2026-01-05", "PAID_FOR_CAFE", 1200_50),
      e("b", "2026-02-01", "PUT_IN", 3000_00),
    ]);
    expect(a.lines.map((l) => [l.id, l.balanceMinor])).toEqual([["c", -799_50], ["b", 4200_50], ["a", 1200_50]]);
    expect(a.balanceMinor).toBe(-799_50);
    expect(a.paidForCafeMinor).toBe(1200_50);
    expect(a.putInMinor).toBe(3000_00);
    expect(a.tookOutMinor).toBe(5000_00);
    expect(a.paidForCafeMinor + a.putInMinor - a.tookOutMinor).toBe(a.balanceMinor);
  });

  it("السنواتُ كلٌّ بصافيها، ومجموعُها الرصيد", () => {
    const a = buildOwnerAccount([
      e("a", "2025-12-30", "TOOK_OUT", 1000_00),
      e("b", "2026-01-02", "PUT_IN", 400_00),
      e("c", "2026-06-02", "TOOK_OUT", 100_00),
    ]);
    expect(a.years).toEqual([
      { year: "2026", paidForCafeMinor: 0, putInMinor: 400_00, tookOutMinor: 100_00, netMinor: 300_00 },
      { year: "2025", paidForCafeMinor: 0, putInMinor: 0, tookOutMinor: 1000_00, netMinor: -1000_00 },
    ]);
    expect(a.years.reduce((s, y) => s + y.netMinor, 0)).toBe(a.balanceMinor);
  });

  it("بلا قيودٍ لا سطورَ ولا سنوات", () => {
    const a = buildOwnerAccount([]);
    expect(a.lines).toEqual([]);
    expect(a.years).toEqual([]);
  });
});
