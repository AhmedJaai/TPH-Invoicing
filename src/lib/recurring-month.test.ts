import { describe, expect, it } from "vitest";
import { buildMonthWatch, type MonthWatchInput } from "./recurring-month";

const base: MonthWatchInput = { month: "2026-11", today: "2026-11-28", lastBankDay: "2026-11-22", registered: [], paid: [], series: [] };
const rent = { id: "r1", label: "الإيجار", amountMinor: 1_500_000, cadence: "MONTHLY" as const, startsOn: "2026-01-10", endsOn: null, category: "RENT" };
const tel = { key: "k1", label: "الاتصالات", category: "UTILITY" as const, usualMinor: 28_750, dayOfMonth: 1, charges: [{ id: "t1", day: "2026-10-01", amountMinor: 28_750 }], registered: null };

describe("buildMonthWatch", () => {
  it("المسجَّل المدفوع وصل، والمكتشف الذي غطّى الكشف يومه ولم يُخصم تأخّر", () => {
    const w = buildMonthWatch({ ...base, registered: [rent], paid: [{ recurringExpenseId: "r1", day: "2026-11-10", amountMinor: 1_500_000 }], series: [tel] });
    expect(w.rows.map((r) => [r.label, r.status])).toEqual([["الاتصالات", "LATE"], ["الإيجار", "ARRIVED"]]);
    expect(w.expectedMinor).toBe(1_528_750);
    expect(w.arrivedMinor).toBe(1_500_000);
    expect(w.late).toHaveLength(1);
  });

  it("الوصول من الكشف حين لم يُقيَّد مصروف، والسلسلة المطابقة لا تتكرّر صفاً", () => {
    const w = buildMonthWatch({ ...base, registered: [rent], series: [{ ...tel, registered: { id: "r1" }, charges: [{ id: "t2", day: "2026-11-11", amountMinor: 1_500_000 }] }] });
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ status: "ARRIVED", arrived: { via: "BANK", day: "2026-11-11" }, seriesKey: "k1" });
  });

  it("ما مضى موعده بعد آخر الكشف لا يُحكم بتأخّره، وما لم يحن قادم", () => {
    const w = buildMonthWatch({ ...base, registered: [{ ...rent, startsOn: "2026-01-25" }, { ...rent, id: "r2", label: "إنترنت", startsOn: "2026-01-30" }] });
    expect(w.rows.map((r) => [r.label, r.status])).toEqual([["الإيجار", "NOT_SEEN"], ["إنترنت", "UPCOMING"]]);
  });

  it("المسكَت اقتراحُه لا يُتوقَّع", () => {
    expect(buildMonthWatch({ ...base, series: [{ ...tel, suggestionSilenced: true }] }).rows).toEqual([]);
  });
});
