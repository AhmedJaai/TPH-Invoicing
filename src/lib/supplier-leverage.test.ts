import { describe, expect, it } from "vitest";
import { concentration, weightedDaysToPay } from "./supplier-leverage";

const sp = (id: string, minor: number) => ({ supplierId: id, name: id, slug: id, minor });

describe("أيّام السداد المرجّحة", () => {
  it("الفاتورة الكبيرة تزن أكثر", () => {
    const r = weightedDaysToPay([
      { days: 60, amountMinor: 10_000_00 },
      { days: 0, amountMinor: 100_00 }, { days: 0, amountMinor: 100_00 }, { days: 0, amountMinor: 100_00 }, { days: 0, amountMinor: 100_00 },
    ]);
    expect(r).toEqual({ weightedDays: 58, sampleCount: 5 });
  });

  it("دون خمس فواتير: غير معروف لا صفر", () => {
    expect(weightedDaysToPay([{ days: 10, amountMinor: 100 }])).toEqual({ weightedDays: null, sampleCount: 1 });
    expect(weightedDaysToPay([])).toEqual({ weightedDays: null, sampleCount: 0 });
  });

  it("المدفوعة قبل تاريخها صفر يوم لا يوم سالب", () => {
    const r = weightedDaysToPay(Array.from({ length: 5 }, () => ({ days: -4, amountMinor: 100_00 })));
    expect(r.weightedDays).toBe(0);
  });
});

describe("تركّز المورّدين", () => {
  it("حصّة الثلاثة الأوائل، والأوّل فوق ٤٠٪ يسمّى", () => {
    const c = concentration([sp("a", 5_000_00), sp("b", 2_000_00), sp("c", 2_000_00), sp("d", 1_000_00)]);
    expect(c?.totalMinor).toBe(10_000_00);
    expect(c?.top.map((t) => [t.supplierId, t.shareBp])).toEqual([["a", 5_000], ["b", 2_000], ["c", 2_000]]);
    expect(c?.topShareBp).toBe(9_000);
    expect(c?.dominant?.supplierId).toBe("a");
    expect(c?.supplierCount).toBe(4);
  });

  it("أربعون بالضبط ليست تركّزاً", () => {
    expect(concentration([sp("a", 40), sp("b", 30), sp("c", 30)])?.dominant).toBeNull();
  });

  it("بلا مشتريات: لا رقم", () => {
    expect(concentration([])).toBeNull();
    expect(concentration([sp("a", 0)])).toBeNull();
  });
});
