import { describe, expect, it } from "vitest";
import { formatRiyals, formatRiyalsDisplay, parseRiyals } from "./money";

describe("تحويل المبالغ", () => {
  it("يقرأ الأرقام اللاتينية", () => {
    expect(parseRiyals("410.00")).toBe(41_000);
    expect(parseRiyals("410")).toBe(41_000);
    expect(parseRiyals("17,572.00")).toBe(1_757_200);
    expect(parseRiyals("4151.50")).toBe(415_150);
  });

  it("يقرأ الأرقام العربية الهندية وفواصلها", () => {
    expect(parseRiyals("٤١٠٫٠٠")).toBe(41_000);
    expect(parseRiyals("١٧٬٥٧٢")).toBe(1_757_200);
  });

  it("يرفض ما ليس مبلغاً", () => {
    expect(parseRiyals("")).toBeNull();
    expect(parseRiyals("abc")).toBeNull();
    /* رقمٌ ملتصقٌ بحروف: لا يُعرَف أين ينتهي المبلغ */
    expect(parseRiyals("SAR410")).toBeNull();
    expect(parseRiyals("12ريالx")).toBeNull();
  });

  /*
    ── ما كان يُرَدّ فصار يُقبَل، وبدليلٍ من الأرشيف ──

    كان «1,151.15 SR» و«437.000» يُردّان `null` — أي «لم يُقرأ». وكشف
    القياسُ ثمنَ ذلك: مستندان قُرئا كاملَين ولم تُنشَأ لهما فاتورة،
    فبقيا في الأرشيف بلا رقمٍ ولا اسمٍ ولا ظهورٍ في البحث. فالتشدّد
    الذي يبدو حذراً أضاع مالاً مقروءاً.

    والقبول مضيَّقٌ عمداً: رمزُ العملة يُسقَط إن كان منفصلاً، والمنزلة
    الثالثة تُقبَل **إن كانت صفراً وحدها** — فـ«437.005» مبلغٌ لا
    يُمثَّل بالهللات، وحسمُه تخمين.
  */
  it("يقبل رمز العملة منفصلاً — والمورّد يكتبه", () => {
    expect(parseRiyals("1,151.15 SR")).toBe(115_115);
    expect(parseRiyals("SAR 1,250.50")).toBe(125_050);
    expect(parseRiyals("1250 ريال")).toBe(125_000);
    expect(parseRiyals("1250 ر.س")).toBe(125_000);
  });

  it("ويقبل المنزلة الثالثة إن كانت صفراً — و«437.000» هو «437.00» يقيناً", () => {
    expect(parseRiyals("437.000")).toBe(43_700);
    expect(parseRiyals("437.0")).toBe(43_700);
  });

  it("ويردّ المنزلة الثالثة غير الصفر — والمجهول يُعلَن ولا يُقرَّب", () => {
    expect(parseRiyals("437.005")).toBeNull();
    expect(parseRiyals("437.123")).toBeNull();
  });

  it("يطبع منزلتين دائماً", () => {
    expect(formatRiyals(41_000)).toBe("410.00");
    expect(formatRiyals(5)).toBe("0.05");
    expect(formatRiyals(1_757_200)).toBe("17572.00");
    expect(formatRiyalsDisplay(1_757_200)).toBe("17,572.00");
  });

  it("لا يفقد هللة في الجمع المتكرر", () => {
    // 0.1 + 0.2 !== 0.3 في الفاصلة العائمة. بالهللات لا خطأ إطلاقاً.
    let total = 0;
    for (let i = 0; i < 1000; i++) total += 1010; // ١٠٫١٠ ريال
    expect(total).toBe(1_010_000);
    expect(formatRiyals(total)).toBe("10100.00");
  });
});
