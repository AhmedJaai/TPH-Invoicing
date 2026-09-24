import { describe, expect, it } from "vitest";
import { amountsAddUp, invoiceHref, priceMove, weakFields } from "./invoice-profile";
import { TOTAL_ROUNDING_TOLERANCE_MINOR } from "./money";

const prev = (unitPriceMinor: number) => ({ unitPriceMinor, date: new Date("2026-08-01"), invoiceNumber: "A-1" });

describe("priceMove — سعرُ البند مقابل آخر شراء", () => {
  it("ارتفاعٌ بنسبةٍ صحيحة من الهللات", () => {
    const m = priceMove(4600, prev(4000));
    expect(m).toMatchObject({ deltaMinor: 600, percent: 15, direction: "up", previousNumber: "A-1" });
  });

  it("انخفاض", () => {
    expect(priceMove(3000, prev(4000))).toMatchObject({ deltaMinor: -1000, percent: -25, direction: "down" });
  });

  it("لم يتغيّر", () => {
    expect(priceMove(4000, prev(4000))).toMatchObject({ deltaMinor: 0, percent: 0, direction: "same" });
  });

  it("السابقُ صفرٌ → النسبة مجهولة لا صفر", () => {
    expect(priceMove(500, prev(0)).percent).toBeNull();
  });

  it("التقريب إلى أقرب عدد صحيح", () => {
    expect(priceMove(1001, prev(3000)).percent).toBe(-67);
  });
});

describe("weakFields — ما قُرئ بثقةٍ ضعيفة", () => {
  it("المجهولُ لا يُعدّ ضعيفاً", () => {
    expect(weakFields(null)).toEqual([]);
  });

  it("يرتّب الأضعف أوّلاً ويسمّيه بالعربيّة", () => {
    expect(weakFields({ amounts: 0.5, invoiceNumber: 0.7, invoiceDate: 0.95 })).toEqual(["المبالغ", "رقم الفاتورة"]);
  });

  it("الحدُّ نفسُه مقبول", () => {
    expect(weakFields({ amounts: 0.8 })).toEqual([]);
  });
});

describe("amountsAddUp — الصافي + الضريبة = الإجمالي", () => {
  it("مجهولٌ إن لم يُقرأ الصافي أو الضريبة", () => {
    expect(amountsAddUp(null, 150, 1150, TOTAL_ROUNDING_TOLERANCE_MINOR)).toBeNull();
    expect(amountsAddUp(1000, null, 1150, TOTAL_ROUNDING_TOLERANCE_MINOR)).toBeNull();
  });

  it("يستقيم ضمن ريال", () => {
    expect(amountsAddUp(1000, 150, 1150, TOTAL_ROUNDING_TOLERANCE_MINOR)).toBe(true);
    expect(amountsAddUp(1000, 150, 1250, TOTAL_ROUNDING_TOLERANCE_MINOR)).toBe(true);
  });

  it("لا يستقيم فوق ريال", () => {
    expect(amountsAddUp(1000, 150, 1251, TOTAL_ROUNDING_TOLERANCE_MINOR)).toBe(false);
  });
});

describe("invoiceHref", () => {
  it("يبني الرابط ومرساته", () => {
    expect(invoiceHref("abc")).toBe("/purchases/invoices/abc");
    expect(invoiceHref("abc", "tax")).toBe("/purchases/invoices/abc#tax");
  });
});
