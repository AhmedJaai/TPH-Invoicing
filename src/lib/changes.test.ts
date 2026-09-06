import { describe, expect, it } from "vitest";
import { NOISE_PCT, buildChanges, direction, notable, pctChange, type ChangeFacts } from "./changes";

const quiet: ChangeFacts = {
  purchasesThisMonth: 100_00, purchasesPrevMonth: 100_00,
  thisMonthLabel: "2026-09", prevMonthLabel: "2026-08",
  documentsLast7: 0, documentsPrev7: 0,
  outstandingNow: 500_00, outstandingThen: 500_00,
  risingItems: 0, risingAnnualMinor: 0,
  newUnclassified: 0,
  daysElapsedInMonth: null,
};
const f = (o: Partial<ChangeFacts> = {}): ChangeFacts => ({ ...quiet, ...o });

describe("direction", () => {
  it("ما دون حدّ الضجيج ساكن", () => {
    expect(direction(104, 100)).toBe("FLAT");
    expect(direction(96, 100)).toBe("FLAT");
    expect(NOISE_PCT).toBe(5);
  });

  it("ما جاوزه ارتفاع أو انخفاض", () => {
    expect(direction(120, 100)).toBe("UP");
    expect(direction(80, 100)).toBe("DOWN");
  });

  it("لا أساس فلا نسبة — يُقال جديد", () => {
    expect(direction(500, 0)).toBe("NEW");
  });

  it("صفرٌ من صفر سكون لا جديد", () => {
    expect(direction(0, 0)).toBe("FLAT");
  });
});

describe("pctChange", () => {
  it("لا نسبة إلى صفر", () => {
    expect(pctChange(100, 0)).toBeNull();
  });

  it("النسبة تُحسب من الأساس", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
  });
});

describe("buildChanges", () => {
  it("ارتفاع المشتريات لا يُحكَم عليه — قد يكون نموّاً", () => {
    const c = buildChanges(f({ purchasesThisMonth: 200_00 })).find((x) => x.id === "purchases")!;
    expect(c.direction).toBe("UP");
    expect(c.favourable).toBeNull();
  });

  it("ارتفاع ما عليك ليس في صالحك وانخفاضه في صالحك", () => {
    const up = buildChanges(f({ outstandingNow: 900_00 })).find((x) => x.id === "outstanding")!;
    const down = buildChanges(f({ outstandingNow: 100_00 })).find((x) => x.id === "outstanding")!;
    expect(up.favourable).toBe(false);
    expect(down.favourable).toBe(true);
  });

  it("لا يظهر ما لا وجود له", () => {
    const ids = buildChanges(quiet).map((c) => c.id);
    expect(ids).not.toContain("prices");
    expect(ids).not.toContain("unclassified");
    expect(ids).not.toContain("documents");
  });

  it("لكل تغيّر أساسٌ مذكور ووجهة", () => {
    const all = buildChanges(f({
      purchasesThisMonth: 300_00, documentsLast7: 9, documentsPrev7: 2,
      outstandingNow: 900_00, risingItems: 3, risingAnnualMinor: 5_000_00,
      newUnclassified: 12,
    }));
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const c of all) {
      expect(c.baseline.length).toBeGreaterThan(0);
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });

  it("أوّل شهر يُقال عنه جديد لا ارتفاعاً بلا نهاية", () => {
    const c = buildChanges(f({ purchasesPrevMonth: 0, purchasesThisMonth: 50_00 }))
      .find((x) => x.id === "purchases")!;
    expect(c.direction).toBe("NEW");
    expect(c.pct).toBeNull();
  });
});

describe("notable", () => {
  it("تُسقط الساكن وتُبقي ما تغيّر", () => {
    const all = buildChanges(f({ outstandingNow: 900_00, newUnclassified: 4 }));
    const shown = notable(all);
    expect(shown.every((c) => c.direction !== "FLAT")).toBe(true);
    expect(shown.map((c) => c.id)).toContain("outstanding");
  });

  it("السكون التامّ يُنتج فراغاً — وهو خبرٌ بذاته", () => {
    expect(notable(buildChanges(quiet))).toEqual([]);
  });
});

describe("الشهر الجاري يُقارَن بمثله", () => {
  /*
    كان الشهر الجاري يُقارَن بشهرٍ تامّ، فيُقال في السادس من كل شهر
    «أنفقتَ أقلّ بـ٩٨٪» — والنقص يومٌ لا سلوك.
  */
  it("الشهر الناقص يقول في أساسه كم يوماً قِيس", () => {
    const c = buildChanges(f({ daysElapsedInMonth: 6 })).find((x) => x.id === "purchases");
    expect(c?.baseline).toBe("عن أوّل 6 يوماً من 2026-08");
  });

  it("الشهر التامّ يُقارَن بالشهر كلّه", () => {
    const c = buildChanges(f({ daysElapsedInMonth: null })).find((x) => x.id === "purchases");
    expect(c?.baseline).toBe("عن 2026-08");
  });
});
