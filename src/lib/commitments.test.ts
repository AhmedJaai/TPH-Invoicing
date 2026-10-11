import { describe, expect, it } from "vitest";
import { buildCommitments, type CommitmentsInput } from "./commitments";

const base: CommitmentsInput = {
  today: "2026-10-12", fromMonth: "2026-10", months: 2,
  overdueRun: [], nextRun: [], recurring: [], vat: [], expiries: [],
};
const rent = { id: "r1", label: "الإيجار", amountMinor: 1_500_000, cadence: "MONTHLY" as const, startsOn: "2026-01-27", endsOn: null };

describe("buildCommitments", () => {
  it("بلا وقائع لا أيّام", () => {
    const c = buildCommitments(base);
    expect(c.days).toEqual([]);
    expect(c.undated).toEqual([]);
    expect(c.totalMinor).toBe(0);
  });

  it("الدفعةُ المنقضية أوّلَ هذا الشهر (وقد مضى)، والجاريةُ أوّلَ القادم", () => {
    const c = buildCommitments({
      ...base,
      overdueRun: [{ supplierId: "a", supplierName: "أ", amountMinor: 10_000 }],
      nextRun: [{ supplierId: "b", supplierName: "ب", amountMinor: 20_000 }],
    });
    expect(c.days.map((d) => [d.day, d.totalMinor, d.past])).toEqual([["2026-10-01", 10_000, true], ["2026-11-01", 20_000, false]]);
  });

  it("المتكرّرُ بيومه في كلّ شهر، وما دُفع هذا الشهر لا يُعرض ثانيةً", () => {
    const c = buildCommitments({ ...base, recurring: [rent] });
    expect(c.days.map((d) => d.day)).toEqual(["2026-10-27", "2026-11-27"]);
    const paid = buildCommitments({ ...base, recurring: [rent], paidThisMonth: new Set(["r1"]) });
    expect(paid.days.map((d) => d.day)).toEqual(["2026-11-27"]);
  });

  it("المتكرّرُ بلا يومٍ يُسرَد «بلا يوم» في شهره ولا يُخترَع له يوم", () => {
    const c = buildCommitments({ ...base, recurring: [{ ...rent, startsOn: null }] });
    expect(c.days).toEqual([]);
    expect(c.undated.map((u) => [u.month, u.items.length])).toEqual([["2026-10", 1], ["2026-11", 1]]);
  });

  it("يومُ ٣١ يقع آخرَ الشهر الأقصر", () => {
    const c = buildCommitments({ ...base, fromMonth: "2026-11", months: 1, recurring: [{ ...rent, startsOn: "2026-01-31" }] });
    expect(c.days.map((d) => d.day)).toEqual(["2026-11-30"]);
  });

  it("ضريبةٌ مجهولةُ المبلغ تظهر في موعدها بلا رقمٍ ولا تدخل المجموع", () => {
    const c = buildCommitments({
      ...base,
      vat: [{ periodKey: "2026-Q3", label: "الربع الثالث 2026", deadline: "2026-10-31", amountMinor: null, accruing: false }],
      recurring: [{ ...rent, startsOn: "2026-01-31" }],
    });
    const day = c.days.find((d) => d.day === "2026-10-31");
    expect(day?.totalMinor).toBe(1_500_000);
    expect(day?.hasUnknown).toBe(true);
    expect(day?.items.find((i) => i.kind === "VAT")?.amountMinor).toBeNull();
  });

  it("رصيدٌ دائن: الموعدُ يبقى والمبلغُ صفرٌ معلوم", () => {
    const c = buildCommitments({ ...base, vat: [{ periodKey: "q", label: "ر", deadline: "2026-10-31", amountMinor: -500, accruing: false }] });
    expect(c.days[0].items[0].amountMinor).toBe(0);
    expect(c.days[0].hasUnknown).toBe(false);
  });

  it("ما فات موعدُه قبل أوّل شهرٍ معروض يُجمع «متأخّراً»، وما بعد آخره لا يُعرض", () => {
    const c = buildCommitments({
      ...base,
      vat: [{ periodKey: "2026-Q2", label: "الربع الثاني", deadline: "2026-07-31", amountMinor: 900, accruing: false }],
      expiries: [
        { id: "x", title: "رخصة البلديّة", kindLabel: "رخصة", expiresOn: "2026-09-01" },
        { id: "y", title: "السجلّ", kindLabel: "سجلّ", expiresOn: "2027-03-01" },
        { id: "z", title: "شهادة", kindLabel: "شهادة", expiresOn: "2026-11-05" },
      ],
    });
    expect(c.overdue.map((o) => o.id)).toEqual(["vat:2026-Q2", "exp:x"]);
    expect(c.days.map((d) => d.day)).toEqual(["2026-11-05"]);
    expect(c.days[0].hasUnknown).toBe(false);
  });

  it("اليومُ يُعلَّم", () => {
    const c = buildCommitments({ ...base, recurring: [{ ...rent, startsOn: "2026-01-12" }] });
    expect(c.days[0]).toMatchObject({ day: "2026-10-12", today: true, past: false });
  });
});
