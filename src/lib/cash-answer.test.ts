import { describe, expect, it } from "vitest";
import { buildCommitments, type CommitmentsInput } from "./commitments";
import { buildCashAnswer } from "./cash-answer";

const base: CommitmentsInput = {
  today: "2026-10-12", fromMonth: "2026-10", months: 3,
  overdueRun: [], nextRun: [], recurring: [], vat: [], expiries: [],
};
const rent = { id: "r1", label: "الإيجار", amountMinor: 1_500_000, cadence: "MONTHLY" as const, startsOn: "2026-01-20", endsOn: null };
const answer = (c: Partial<CommitmentsInput>, more: { balanceMinor?: number | null; balanceAsOf?: string | null; withVat?: boolean; floorMinor?: number | null } = {}) =>
  buildCashAnswer({
    commitments: buildCommitments({ ...base, ...c }),
    today: base.today,
    balanceMinor: more.balanceMinor === undefined ? 5_000_000 : more.balanceMinor,
    balanceAsOf: more.balanceAsOf === undefined ? "2026-10-11" : more.balanceAsOf,
    withVat: more.withVat ?? true,
    floorMinor: more.floorMinor ?? null,
  });

describe("buildCashAnswer", () => {
  it("المتأخّر يُطرح الآن، والجاري في يومه، وأضيق يوم أدنى رصيد", () => {
    const a = answer({
      overdueRun: [{ supplierId: "a", supplierName: "أ", amountMinor: 1_000_000 }],
      nextRun: [{ supplierId: "b", supplierName: "ب", amountMinor: 2_000_000 }],
      recurring: [rent],
    });
    expect(a.days.map((d) => [d.day, d.outMinor, d.afterMinor])).toEqual([
      ["now", 1_000_000, 4_000_000],
      ["2026-10-20", 1_500_000, 2_500_000],
      ["2026-11-01", 2_000_000, 500_000],
      ["2026-11-20", 1_500_000, -1_000_000],
    ]);
    expect(a.monthEnd.afterMinor).toBe(2_500_000);
    expect(a.horizonEnd.afterMinor).toBe(-1_000_000);
    expect(a.tightest).toEqual({ day: "2026-11-20", afterMinor: -1_000_000 });
    expect(a.firstShort).toEqual({ day: "2026-11-20", shortMinor: 1_000_000 });
    /* الشهر الثالث خارج الأفق */
    expect(a.days.some((d) => d.day.startsWith("2026-12"))).toBe(false);
  });

  it("المتكرّر الذي مضى يومه لا يُطرح ويُنقص الثقة", () => {
    const a = answer({ recurring: [{ ...rent, startsOn: "2026-01-05" }] });
    expect(a.days.map((d) => d.day)).toEqual(["2026-11-05"]);
    expect(a.skippedPast).toHaveLength(1);
    expect(a.confidence).toBe("MEDIUM");
  });

  it("بلا يوم يُطرح أوّل شهره احتياطاً", () => {
    const a = answer({ recurring: [{ ...rent, startsOn: null }] });
    expect(a.days.map((d) => [d.day, d.outMinor])).toEqual([["now", 1_500_000], ["2026-11-01", 1_500_000]]);
  });

  it("المبلغ المجهول لا يصير صفراً بل يُعدّ ويُضعف الثقة", () => {
    const a = answer({ vat: [{ periodKey: "2026-Q3", label: "الربع الثالث", deadline: "2026-10-31", amountMinor: null, accruing: false }] });
    expect(a.days[0]).toMatchObject({ day: "2026-10-31", outMinor: 0, unknownCount: 1, afterMinor: 5_000_000 });
    expect(a.tightest).toBeNull();
    expect(a.confidence).toBe("LOW");
  });

  it("الضريبة تُستبعد بطلب صاحبها", () => {
    const vat = [{ periodKey: "2026-Q3", label: "الربع الثالث", deadline: "2026-10-31", amountMinor: 300_000, accruing: false }];
    expect(answer({ vat }).horizonEnd.afterMinor).toBe(4_700_000);
    expect(answer({ vat }, { withVat: false }).horizonEnd.afterMinor).toBe(5_000_000);
  });

  it("الرصيد المجهول لا يُرسم ولا يُحكم به", () => {
    const a = answer({ recurring: [rent] }, { balanceMinor: null, balanceAsOf: null });
    expect(a.days.every((d) => d.afterMinor === null)).toBe(true);
    expect(a.tightest).toBeNull();
    expect(a.confidence).toBe("LOW");
  });

  it("الرصيد القديم يُضعف الثقة، والحدّ الأدنى يُسمّى يومه", () => {
    expect(answer({}, { balanceAsOf: "2026-09-01" }).confidence).toBe("LOW");
    expect(answer({}, { balanceAsOf: "2026-10-05" }).confidence).toBe("MEDIUM");
    expect(answer({}).confidence).toBe("HIGH");
    const a = answer({ recurring: [rent] }, { floorMinor: 3_000_000 });
    expect(a.firstBelowFloor).toEqual({ day: "2026-11-20", afterMinor: 2_000_000 });
  });
});
