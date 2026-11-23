import { describe, expect, it } from "vitest";
import { compareBudget, effectiveBudgets, type BudgetRow } from "./budget";

const at = (iso: string) => new Date(iso);

describe("الساري من الميزانية — التعديلُ صفٌّ جديد", () => {
  const rows: BudgetRow[] = [
    { line: "RENT", amountMinor: 1_000_000, effectiveFrom: "2026-09", createdAt: at("2026-09-01") },
    { line: "RENT", amountMinor: 1_200_000, effectiveFrom: "2026-11", createdAt: at("2026-11-02") },
    { line: "UTILITY", amountMinor: 200_000, effectiveFrom: "2026-10", createdAt: at("2026-10-01") },
    { line: "UTILITY", amountMinor: null, effectiveFrom: "2026-11", createdAt: at("2026-11-05") },
    { line: "COGS", amountMinor: 3_000_000, effectiveFrom: "2026-12", createdAt: at("2026-11-20") },
  ];
  it("أكتوبر: الإيجارُ القديم، والكهرباء", () => {
    expect([...effectiveBudgets(rows, "2026-10")]).toEqual([["RENT", 1_000_000], ["UTILITY", 200_000]]);
  });
  it("نوفمبر: الإيجارُ الجديد، والكهرباءُ أُلغيت، وتكلفةُ المبيعات لم تسرِ بعد", () => {
    expect([...effectiveBudgets(rows, "2026-11")]).toEqual([["RENT", 1_200_000]]);
  });
  it("كتابتان في الشهر نفسه — الأحدثُ كتابةً", () => {
    const twice = [...rows, { line: "RENT", amountMinor: 1_100_000, effectiveFrom: "2026-11", createdAt: at("2026-11-10") }];
    expect(effectiveBudgets(twice, "2026-11").get("RENT")).toBe(1_100_000);
  });
});

describe("مقابلةُ ما صُرف بالميزانية", () => {
  const label = (l: string) => l;
  it("شهرٌ انتهى: تجاوزٌ وقريبٌ وضمنٌ ومجهول", () => {
    const b = new Map([["RENT", 10_000], ["UTILITY", 10_000], ["OTHER", 10_000], ["COGS", 10_000]]);
    const actual = (l: string) => ({ RENT: 12_000, UTILITY: 9_500, OTHER: 2_000, COGS: null }[l] ?? null);
    const v = compareBudget(b, actual, label, null);
    expect(v.map((x) => [x.line, x.state, x.remainingMinor])).toEqual([
      ["RENT", "OVER", -2_000], ["UTILITY", "NEAR", 500], ["COGS", "UNKNOWN", null], ["OTHER", "UNDER", 8_000],
    ]);
  });
  it("الشهرُ الجاري: اليوم العاشر من ثلاثين — ألفان من ثلاثة آلاف «أسرع من الميزانية»", () => {
    const v = compareBudget(new Map([["OTHER", 300_000]]), () => 200_000, label, { elapsedDays: 10, daysInMonth: 30 });
    expect(v[0]).toMatchObject({ paceMinor: 100_000, state: "AHEAD", remainingMinor: 100_000 });
  });
  it("الشهرُ الجاري على وتيرته — ضمن", () => {
    const v = compareBudget(new Map([["OTHER", 300_000]]), () => 100_000, label, { elapsedDays: 10, daysInMonth: 30 });
    expect(v[0].state).toBe("UNDER");
  });
});
