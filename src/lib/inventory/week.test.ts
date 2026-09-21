import { describe, expect, it } from "vitest";
import { dayOfWeek, isInventoryWeek, lastCompleteWeek, nextWeek, shiftDays, weekOf } from "./week";

describe("أسبوعُ الجرد من الأحد إلى السبت", () => {
  it("‏١٣ سبتمبر ٢٠٢٦ أحدٌ و١٩ سبتها — وهو أسبوعُ التصدير الحقيقيّ", () => {
    expect(dayOfWeek("2026-09-13")).toBe(0);
    expect(dayOfWeek("2026-09-19")).toBe(6);
    expect(weekOf("2026-09-16")).toEqual({ start: "2026-09-13", end: "2026-09-19" });
  });

  it("وكلُّ يومٍ في الأسبوع يعطي الأسبوعَ نفسه — الأحدُ والسبتُ وما بينهما", () => {
    for (let i = 0; i < 7; i++) {
      expect(weekOf(shiftDays("2026-09-13", i))).toEqual({ start: "2026-09-13", end: "2026-09-19" });
    }
  });

  /*
    ── الشهرُ والسنةُ لا يقطعان الأسبوع ──

    الحسابُ بـ`Date.UTC` لا بجمعٍ على النصّ، فأسبوعٌ يعبر آخرَ الشهر
    أو آخرَ السنة يبقى سبعةَ أيّام.
  */
  it("ويَعبر الشهرَ والسنةَ بلا كسر", () => {
    expect(weekOf("2026-12-31")).toEqual({ start: "2026-12-27", end: "2027-01-02" });
    expect(weekOf("2027-01-01")).toEqual({ start: "2026-12-27", end: "2027-01-02" });
  });

  it("والتاليَ يبدأ في اليوم الذي يلي السبت — لا فجوةَ ولا تداخل", () => {
    const a = weekOf("2026-09-16");
    const b = nextWeek(a);
    expect(b.start).toBe(shiftDays(a.end, 1));
    expect(b).toEqual({ start: "2026-09-20", end: "2026-09-26" });
  });
});

describe("المقترَحُ آخرُ أسبوعٍ اكتمل", () => {
  /*
    والجاري لا يُقترَح: فرقُه أيّامٌ لم تمضِ بعد، لا فاقد. ويومُ السبت
    نفسُه أسبوعُه لم ينتهِ حتّى تقفيلته.
  */
  it("في الأحد ٢٠ سبتمبر يُقترَح ١٣ → ١٩", () => {
    expect(lastCompleteWeek("2026-09-20")).toEqual({ start: "2026-09-13", end: "2026-09-19" });
  });

  it("وفي السبت ١٩ — وأسبوعُه لم يُقفَل بعد — يبقى المقترَحُ ٦ → ١٢", () => {
    expect(lastCompleteWeek("2026-09-19")).toEqual({ start: "2026-09-06", end: "2026-09-12" });
  });

  it("وفي الأربعاء ١٦ كذلك", () => {
    expect(lastCompleteWeek("2026-09-16")).toEqual({ start: "2026-09-06", end: "2026-09-12" });
  });
});

describe("ما ليس أسبوعاً يُردّ", () => {
  it("الأحدُ إلى السبت وحدَه يُقبَل", () => {
    expect(isInventoryWeek("2026-09-13", "2026-09-19")).toBe(true);
  });

  it("والأربعاءُ إلى الثلاثاء سبعةُ أيّامٍ ولا يُقبَل — البدايةُ هي الشرط", () => {
    expect(isInventoryWeek("2026-09-16", "2026-09-22")).toBe(false);
  });

  it("وأحدٌ إلى أحدٍ ثمانيةُ أيّامٍ — يومٌ يُحسَب في جردين", () => {
    expect(isInventoryWeek("2026-09-13", "2026-09-20")).toBe(false);
  });

  it("وأسبوعان معاً ليسا أسبوعاً", () => {
    expect(isInventoryWeek("2026-09-13", "2026-09-26")).toBe(false);
  });

  it("وما ليس تاريخاً يُردّ ولا يُرمى", () => {
    expect(isInventoryWeek("", "2026-09-19")).toBe(false);
    expect(isInventoryWeek("2026-9-13", "2026-09-19")).toBe(false);
  });
});
