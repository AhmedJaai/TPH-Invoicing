import { describe, expect, it } from "vitest";
import { monthBalancesFromStatement, type BalanceRow } from "./statement-balances";

const row = (n: number, day: string, dir: "DEBIT" | "CREDIT", amount: number, balance?: number): BalanceRow => ({
  rowNumber: n, valueDate: new Date(`${day}T00:00:00Z`), direction: dir, amountMinor: amount, balanceMinor: balance,
});

describe("رصيدا الشهر من عمود الرصيد", () => {
  it("الأقدم أوّلاً: الافتتاحيّ قبل أوّل حركة والختاميّ بعد آخرها", () => {
    const r = monthBalancesFromStatement([
      row(1, "2026-08-01", "CREDIT", 1000, 11000),
      row(2, "2026-08-10", "DEBIT", 3000, 8000),
      row(3, "2026-08-31", "DEBIT", 500, 7500),
    ]);
    expect(r).toEqual([{ month: "2026-08", periodStart: "2026-08-01", periodEnd: "2026-08-31", openingMinor: 10000, closingMinor: 7500, rows: 3 }]);
  });

  it("الأحدث أوّلاً — يُعرف الاتّجاه من اتّساق السلسلة", () => {
    const r = monthBalancesFromStatement([
      row(1, "2026-08-31", "DEBIT", 500, 7500),
      row(2, "2026-08-10", "DEBIT", 3000, 8000),
      row(3, "2026-08-01", "CREDIT", 1000, 11000),
    ]);
    expect(r[0]).toMatchObject({ openingMinor: 10000, closingMinor: 7500 });
  });

  it("سلسلةٌ لا تستقيم لا تُعطي رصيداً — المجهول ليس صفراً", () => {
    expect(monthBalancesFromStatement([
      row(1, "2026-08-01", "CREDIT", 1000, 11000),
      row(2, "2026-08-10", "DEBIT", 3000, 9999),
    ])).toEqual([]);
  });

  it("وصفٌّ بلا رصيد في الشهر يُسقط الشهر كلّه", () => {
    expect(monthBalancesFromStatement([
      row(1, "2026-08-01", "CREDIT", 1000, 11000),
      row(2, "2026-08-10", "DEBIT", 3000),
      row(3, "2026-08-11", "DEBIT", 1000, 7000),
    ])).toEqual([]);
  });
});
