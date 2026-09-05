import { describe, expect, it } from "vitest";
import { analyzeCoverage, describeCoverage, type Period } from "./coverage";

const p = (start: string, end: string, label?: string): Period => ({ start, end, label });

describe("analyzeCoverage", () => {
  it("لا فترات فلا تغطية", () => {
    const c = analyzeCoverage([]);
    expect(c.from).toBeNull();
    expect(c.coveredDays).toBe(0);
  });

  it("فترة واحدة تُحسب أيامها بطرفيها", () => {
    const c = analyzeCoverage([p("2026-08-01", "2026-08-31")]);
    expect(c.coveredDays).toBe(31);
    expect(c.gaps).toEqual([]);
  });

  it("كشفٌ ينتهي في ٣١ وآخر يبدأ في ١ متّصلان لا فجوة بينهما", () => {
    const c = analyzeCoverage([p("2026-08-01", "2026-08-31"), p("2026-09-01", "2026-09-30")]);
    expect(c.gaps).toEqual([]);
    expect(c.coveredDays).toBe(61);
  });

  it("الفجوة تُكشَف بيومها الأوّل وآخرها", () => {
    const c = analyzeCoverage([p("2026-08-01", "2026-08-10"), p("2026-08-18", "2026-08-31")]);
    expect(c.gaps).toHaveLength(1);
    expect(c.gaps[0]).toEqual({ start: "2026-08-11", end: "2026-08-17", days: 7 });
  });

  it("التداخل يُكشَف بمداه", () => {
    const c = analyzeCoverage([p("2026-08-01", "2026-08-31"), p("2026-08-15", "2026-09-15")]);
    expect(c.overlaps).toHaveLength(1);
    expect(c.overlaps[0].start).toBe("2026-08-15");
    expect(c.overlaps[0].end).toBe("2026-08-31");
    expect(c.overlaps[0].days).toBe(17);
    // والتداخل لا يُنتج فجوة
    expect(c.gaps).toEqual([]);
  });

  it("التداخل لا يُضاعف الأيام المغطّاة", () => {
    const c = analyzeCoverage([p("2026-08-01", "2026-08-31"), p("2026-08-01", "2026-08-31")]);
    expect(c.coveredDays).toBe(31);
  });

  it("فترات كثيرة: فجوتان وتداخل", () => {
    const c = analyzeCoverage([
      p("2026-05-01", "2026-05-31"),
      p("2026-07-01", "2026-07-20"),
      p("2026-07-15", "2026-07-31"),
      p("2026-09-01", "2026-09-30"),
    ]);
    expect(c.gaps).toHaveLength(2);
    expect(c.overlaps).toHaveLength(1);
    expect(c.from).toBe("2026-05-01");
    expect(c.to).toBe("2026-09-30");
  });

  it("الفترة المقلوبة تُتجاهَل ولا تكسر الحساب", () => {
    const c = analyzeCoverage([p("2026-08-31", "2026-08-01"), p("2026-08-01", "2026-08-10")]);
    expect(c.coveredDays).toBe(10);
  });
});

describe("describeCoverage", () => {
  it("تقول المتّصلة متّصلة", () => {
    const s = describeCoverage(analyzeCoverage([p("2026-08-01", "2026-08-31")]));
    expect(s).toContain("متّصلة بلا فجوة");
  });

  it("تُقدّم الفجوة — فهي وحدها ما لا يُصلحه شيء إلّا رفع كشفها", () => {
    const s = describeCoverage(analyzeCoverage([
      p("2026-08-01", "2026-08-10"),
      p("2026-08-18", "2026-08-31"),
    ]));
    expect(s).toContain("فجوة");
    expect(s).toContain("2026-08-11");
  });

  it("تقول إنّ التداخل لا يضرّ", () => {
    const s = describeCoverage(analyzeCoverage([
      p("2026-08-01", "2026-08-31"),
      p("2026-08-15", "2026-09-15"),
    ]));
    expect(s).toContain("لا يضرّ");
  });

  it("لا شيء بعد", () => {
    expect(describeCoverage(analyzeCoverage([]))).toContain("لم يُستورَد");
  });
});
