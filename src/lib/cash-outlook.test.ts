import { describe, expect, it } from "vitest";
import { addMonths, buildCashOutlook, dueThisWeek, occursIn, type OutlookInput, type RecurringInput } from "./cash-outlook";

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

  it("المتكرّرُ الذي قُيِّد دفعُه هذا الشهر لا يُطرَح من الرصيد ثانيةً — ويبقى في الشهر القادم", () => {
    const o = buildCashOutlook({ ...base, recurring: [rent], balanceMinor: 5_000_000, paidThisMonth: new Set(["r1"]) });
    expect(o.buckets.map((b) => b.id)).toEqual(["next-month"]);
    expect(o.totalMinor).toBe(1_500_000);
    const unpaid = buildCashOutlook({ ...base, recurring: [rent], balanceMinor: 5_000_000 });
    expect(unpaid.totalMinor).toBe(3_000_000);
  });

  it("وما خرج من «بقيّة الشهر» لأنّه دُفع يُسمّى بمبلغه في سطر الدلو", () => {
    const other = { ...rent, id: "r2", label: "اشتراكٌ آخر" };
    const o = buildCashOutlook({ ...base, recurring: [rent, other], balanceMinor: 5_000_000, paidThisMonth: new Set(["r1"]) });
    const rest = o.buckets.find((b) => b.id === "rest");
    expect(rest?.lines.map((l) => l.label)).toEqual(["اشتراكٌ آخر"]);
    expect(rest?.when).toContain(`وخرج منها ما قُيِّد دفعُه: ${rent.label}`);
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

describe("dueThisWeek — ما يخرج في الأيّام السبعة القادمة", () => {
  const week = { today: "2026-09-26", overdueRun: [], recurring: [] };

  it("المتأخّرُ مستحقٌّ الآن ويأتي أوّلاً", () => {
    const w = dueThisWeek({
      ...week,
      overdueRun: [{ supplierId: "s1", supplierName: "أوراق الزيتون", amountMinor: 245_000 }],
      recurring: [{ ...rent, startsOn: "2026-01-28" }],
    });
    expect(w.lines.map((l) => [l.label, l.date])).toEqual([["أوراق الزيتون", null], ["الإيجار", "2026-09-28"]]);
    expect(w.totalMinor).toBe(245_000 + 1_500_000);
    expect(w.to).toBe("2026-10-02");
  });

  it("النافذةُ تعبر إلى الشهر التالي", () => {
    const w = dueThisWeek({ ...week, recurring: [{ ...rent, startsOn: "2026-01-01" }] });
    expect(w.lines.map((l) => l.date)).toEqual(["2026-10-01"]);
  });

  it("ما مضى يومُه هذا الشهر لا يُحسب — وما بعد النافذة لا يُحسب", () => {
    expect(dueThisWeek({ ...week, recurring: [{ ...rent, startsOn: "2026-01-20" }] }).lines).toEqual([]);
    expect(dueThisWeek({ ...week, recurring: [{ ...rent, startsOn: "2026-01-15" }] }).lines).toEqual([]);
  });

  it("اليومُ ٣١ في شهرٍ من ثلاثين يقع في آخره", () => {
    const w = dueThisWeek({ ...week, recurring: [{ ...rent, startsOn: "2026-01-31" }] });
    expect(w.lines.map((l) => l.date)).toEqual(["2026-09-30"]);
  });

  it("ما لا يومَ له يُعَدّ ولا يوضَع في يومٍ مخترَع", () => {
    const w = dueThisWeek({ ...week, recurring: [rent] });
    expect(w.lines).toEqual([]);
    expect(w.totalMinor).toBe(0);
    expect(w.undated).toBe(1);
  });

  it("الدفعةُ الصفريّة لا تُعرض سطراً", () => {
    const w = dueThisWeek({ ...week, overdueRun: [{ supplierId: "s1", supplierName: "س", amountMinor: 0 }] });
    expect(w.lines).toEqual([]);
  });
});

/* ── «ماذا لو أجّلتُ هذا؟» — تجربةٌ تنقل الخروجَ ولا تُسقطه ── */
import { LATER_BUCKET, whatIfDefer, type OutlookBucket } from "./cash-outlook";

describe("ماذا لو أجّلتُ هذا؟", () => {
  const line = (id: string, amountMinor: number) => ({ id, label: id, amountMinor, kind: "SUPPLIER" as const, href: "/payments" });
  const bucket = (id: string, lines: ReturnType<typeof line>[]): OutlookBucket => ({
    id, title: id, when: "", tone: "neutral", lines, totalMinor: lines.reduce((s, l) => s + l.amountMinor, 0), afterMinor: null,
  });
  const base = [
    bucket("overdue", [line("run:a", 60_000), line("run:b", 30_000)]),
    bucket("rest", [line("rec:rent", 50_000)]),
    bucket("next-run", [line("next:a", 20_000)]),
  ];

  it("بلا تأجيل: أرقامُ الخادم كما هي، والعجزُ حيث يقع", () => {
    const w = whatIfDefer(base, 100_000, new Set());
    expect(w.buckets.map((b) => b.afterMinor)).toEqual([10_000, -40_000, -60_000]);
    expect(w.shortfallAt).toBe("rest");
    expect(w.deferredMinor).toBe(0);
    expect(w.lowestMinor).toBe(-60_000);
  });

  it("السطرُ المؤجَّل ينتقل إلى المرحلة التالية بمبلغه", () => {
    const w = whatIfDefer(base, 100_000, new Set(["run:a"]));
    expect(w.buckets[0].totalMinor).toBe(30_000);
    expect(w.buckets[1].totalMinor).toBe(110_000);
    expect(w.buckets.map((b) => b.afterMinor)).toEqual([70_000, -40_000, -60_000]);
    expect(w.deferredMinor).toBe(60_000);
  });

  it("المجموعُ لا يتغيّر — التأجيلُ لا يُسقط خروجاً", () => {
    const total = (bs: readonly OutlookBucket[]) => bs.reduce((s, b) => s + b.totalMinor, 0);
    const w = whatIfDefer(base, 100_000, new Set(["run:a", "rec:rent", "next:a"]));
    expect(total(w.buckets)).toBe(total(base));
  });

  it("ما أُجِّل من آخر مرحلة يذهب إلى «بعد ذلك» ولا يختفي", () => {
    const w = whatIfDefer(base, 100_000, new Set(["next:a"]));
    const later = w.buckets.at(-1);
    expect(later?.id).toBe(LATER_BUCKET);
    expect(later?.totalMinor).toBe(20_000);
    expect(w.buckets[2].totalMinor).toBe(0);
  });

  it("الرصيدُ المجهول يبقى مجهولاً — لا يُحسب من صفر", () => {
    const w = whatIfDefer(base, null, new Set(["run:a"]));
    expect(w.buckets.every((b) => b.afterMinor === null)).toBe(true);
    expect(w.shortfallAt).toBeNull();
    expect(w.lowestMinor).toBeNull();
  });
});
