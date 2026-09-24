import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { startState } from "./start";

describe("أوّلُ يوم", () => {
  it("قاعدةٌ فارغة لا تعرف شيئاً — فلا يُقال عنها «سليم»", () => {
    const s = startState({ documents: 0, bankTransactions: 0, recipes: 0 });
    expect(s.knowsNothing).toBe(true);
    expect(s.incomplete).toBe(true);
    expect(s.steps.every((x) => !x.done)).toBe(true);
  });

  it("فواتيرُ بلا كشف: يعرف شيئاً، وتبقى خطوةُ الكشف", () => {
    const s = startState({ documents: 12, bankTransactions: 0, recipes: 0 });
    expect(s.knowsNothing).toBe(false);
    expect(s.incomplete).toBe(true);
    expect(s.steps.find((x) => x.id === "bank")!.done).toBe(false);
  });

  it("الكتالوجُ لا يُبقي الخطوات ظاهرةً — الجردُ اختياريّ لما قبله", () => {
    const s = startState({ documents: 3, bankTransactions: 40, recipes: 0 });
    expect(s.incomplete).toBe(false);
  });

  it("كلُّ خطوةٍ تفتح صفحةً موجودة", () => {
    for (const step of startState({ documents: 0, bankTransactions: 0, recipes: 0 }).steps) {
      const path = step.href.split("#")[0];
      expect(existsSync(path === "/" ? "src/app/(app)/(home)/page.tsx" : `src/app/(app)${path}/page.tsx`), step.href).toBe(true);
    }
  });
});
