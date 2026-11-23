import { describe, expect, it } from "vitest";
import { buildOutstanding, type OutstandingInput, type OutstandingSeries } from "./outstanding";

const stc: OutstandingSeries = {
  key: "SADAD:1", label: "SAUDI TELECOM ", category: "UTILITY", usualMinor: 287_50,
  lastDay: "2026-10-05", dayOfMonth: 5, chargeDays: ["2026-09-08", "2026-10-05"],
};
const base: OutstandingInput = {
  month: "2026-11", today: "2026-11-23", profitMinor: 42_022_70,
  payroll: { owedMinor: 24_706_88, people: 9, unknownPeople: 0, undistributedMinor: 0 },
  recurring: [stc],
  unpaidInvoices: { count: 4, openMinor: 1_200_00 },
};

describe("الربح بعد كل ما عليك", () => {
  it("يطرح رواتب الشهر الباقية وخصماً شهرياً لم يأتِ بعد، ولا يطرح الفواتير (محسوبة في المشتريات)", () => {
    const v = buildOutstanding(base);
    expect(v.lines.map((l) => [l.id, l.amountMinor, l.estimate])).toEqual([["payroll", 24_706_88, false], ["recurring-SADAD:1", 287_50, true]]);
    expect(v.profitAfterMinor).toBe(42_022_70 - 24_706_88 - 287_50);
    expect(v.unpaidInvoices).toEqual({ count: 4, openMinor: 1_200_00 });
  });

  it("خصمٌ جاء هذا الشهر لا يُقدَّر، ولا المنقطع منذ أكثر من ٤٥ يوماً، ولا الرواتب والإيجار", () => {
    const v = buildOutstanding({
      ...base,
      recurring: [
        { ...stc, chargeDays: [...stc.chargeDays, "2026-11-01"], lastDay: "2026-11-01" },
        { ...stc, key: "old", lastDay: "2026-09-10", chargeDays: ["2026-09-10"] },
        { ...stc, key: "sal", category: "SALARY" },
        { ...stc, key: "rent", category: "RENT" },
      ],
    });
    expect(v.lines.map((l) => l.id)).toEqual(["payroll"]);
  });

  it("الشهر الماضي غير المقفل: لا يُقدَّر خصمٌ لم يأتِ فيه — لم يقع، والرواتب الباقية تُطرح", () => {
    const v = buildOutstanding({ ...base, month: "2026-10" });
    expect(v.lines.map((l) => l.id)).toEqual(["payroll"]);
  });

  it("الربح المجهول يبقى مجهولاً، ومن بلا راتب يُقال", () => {
    const v = buildOutstanding({ ...base, profitMinor: null, payroll: { ...base.payroll!, unknownPeople: 2 } });
    expect(v.profitAfterMinor).toBeNull();
    expect(v.unknownPeople).toBe(2);
  });

  it("لا شيء باقٍ: الربح نفسه", () => {
    const v = buildOutstanding({ ...base, payroll: { ...base.payroll!, owedMinor: 0 }, recurring: [] });
    expect(v.lines).toEqual([]);
    expect(v.profitAfterMinor).toBe(42_022_70);
  });
});
