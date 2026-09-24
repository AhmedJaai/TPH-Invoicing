import { describe, expect, it } from "vitest";
import { addMonths, buildCashOutlook, occursIn, type OutlookInput, type RecurringInput } from "./cash-outlook";

const base: OutlookInput = {
  today: "2026-09-24",
  runMonth: "2026-08",
  overdueRun: [],
  heldMinor: 0,
  nextRun: [],
  recurring: [],
  balanceMinor: null,
  balanceAsOf: null,
};

const rent: RecurringInput = { id: "r1", label: "الإيجار", amountMinor: 1_500_000, cadence: "MONTHLY", startsOn: null, endsOn: null };

describe("occursIn — لا يُخترَع يومٌ ولا شهر", () => {
  it("الشهريّ كلَّ شهر، ويومُه مجهولٌ بلا تاريخ بدء", () => {
    expect(occursIn(rent, "2026-10")).toEqual({ occurs: true, day: null });
  });

  it("يومُه من تاريخ البدء إن كُتب كاملاً", () => {
    expect(occursIn({ ...rent, startsOn: "2026-01-27" }, "2026-10")).toEqual({ occurs: true, day: 27 });
  });

  it("الربعيّ والسنويّ بلا تاريخ بدءٍ لا يوضَعان في شهرٍ مخترَع", () => {
    expect(occursIn({ ...rent, cadence: "QUARTERLY" }, "2026-10").occurs).toBe(false);
    expect(occursIn({ ...rent, cadence: "ANNUAL" }, "2026-10").occurs).toBe(false);
  });

  it("الربعيّ كلَّ ثلاثة أشهرٍ من شهر بدئه", () => {
    const q = { ...rent, cadence: "QUARTERLY" as const, startsOn: "2026-01-05" };
    expect(occursIn(q, "2026-10").occurs).toBe(true);
    expect(occursIn(q, "2026-11").occurs).toBe(false);
  });

  it("لا يقع قبل بدئه ولا بعد نهايته", () => {
    expect(occursIn({ ...rent, startsOn: "2026-11-01" }, "2026-10").occurs).toBe(false);
    expect(occursIn({ ...rent, endsOn: "2026-09" }, "2026-10").occurs).toBe(false);
  });
});

describe("buildCashOutlook", () => {
  it("بلا وقائع لا دلاء — لا أصفارٌ تُعرَض كأنّها خروج", () => {
    const o = buildCashOutlook(base);
    expect(o.buckets).toEqual([]);
    expect(o.totalMinor).toBe(0);
  });

  it("المتأخّرُ أوّلاً، ثمّ بقيّة الشهر، ثمّ أوّل القادم، ثمّ خلاله", () => {
    const o = buildCashOutlook({
      ...base,
      overdueRun: [{ supplierId: "a", supplierName: "أ", amountMinor: 10_000 }],
      nextRun: [{ supplierId: "b", supplierName: "ب", amountMinor: 20_000 }],
      recurring: [rent, { ...rent, id: "r2", label: "الرواتب", startsOn: "2026-01-27" }],
    });
    expect(o.buckets.map((b) => b.id)).toEqual(["overdue", "rest", "next-run", "next-month"]);
    expect(o.totalMinor).toBe(10_000 + 20_000 + (1_500_000 * 2) * 2);
  });

  it("المصروفُ الذي فات يومُه هذا الشهر لا يُعدّ مرّةً ثانية", () => {
    const o = buildCashOutlook({ ...base, recurring: [{ ...rent, startsOn: "2026-01-10" }] });
    expect(o.buckets.find((b) => b.id === "rest")).toBeUndefined();
  });

  it("الرصيدُ المجهول لا يُرسَم — لا «يبقى بعدها» عن غير علم", () => {
    const o = buildCashOutlook({ ...base, overdueRun: [{ supplierId: "a", supplierName: "أ", amountMinor: 5 }] });
    expect(o.buckets[0].afterMinor).toBeNull();
    expect(o.shortfallAt).toBeNull();
  });

  it("يُعلَن أوّلُ موضعٍ يقصر فيه الرصيدُ المعروف", () => {
    const o = buildCashOutlook({
      ...base,
      balanceMinor: 15_000,
      balanceAsOf: "2026-08-31",
      overdueRun: [{ supplierId: "a", supplierName: "أ", amountMinor: 10_000 }],
      nextRun: [{ supplierId: "b", supplierName: "ب", amountMinor: 10_000 }],
    });
    expect(o.buckets.map((b) => b.afterMinor)).toEqual([5_000, -5_000]);
    expect(o.shortfallAt).toBe("next-run");
  });

  it("المبالغ هللاتٌ صحيحة — لا عائمة", () => {
    const o = buildCashOutlook({ ...base, overdueRun: [{ supplierId: "a", supplierName: "أ", amountMinor: 1_234_567 }] });
    expect(Number.isInteger(o.totalMinor)).toBe(true);
  });
});

describe("addMonths", () => {
  it("يعبر السنة", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});
