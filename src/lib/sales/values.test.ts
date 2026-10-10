import { describe, expect, it } from "vitest";
import {
  detectDateOrder, microToMinor, normaliseNumeric, parseBusinessDate, parseMoneyMinor,
  parseQuantityMilli, parseSoldAt, parseSourceCostMinor, readSalesAmount,
} from "./values";

/**
 * قراءةُ خلايا ملفّ فودكس — رقمُ مبيعاتٍ يُقرأ خطأً يُفسد فرقَ الجرد كلَّه بصمت.
 * والقاعدةُ في كلّ دالّةٍ هنا واحدة: ما لم يُقرأ `null`، لا صفر.
 */
describe("normaliseNumeric", () => {
  it("الأرقامُ العربيّة إلى اللاتينيّة، وفواصلُ الآلاف والفراغاتُ تسقط", () => {
    expect(normaliseNumeric(" 1,234.50 ")).toBe("1234.50");
    expect(normaliseNumeric("١٬٢٣٤٫٥")).toBe(normaliseNumeric("١٢٣٤٫٥"));
    expect(normaliseNumeric("12 345")).toBe("12345");
    // فراغٌ غير منكسر — يكتبه إكسل بين الآلاف
    expect(normaliseNumeric("12 345")).toBe("12345");
    expect(normaliseNumeric("   ")).toBe("");
  });
});

describe("parseMoneyMinor", () => {
  it("يقرأ المبلغ بالهللات", () => {
    expect(parseMoneyMinor("1,234.50")).toBe(123_450);
    expect(parseMoneyMinor("١٢٣٤٫٥")).toBe(123_450);
    expect(parseMoneyMinor("١٬٢٣٤٫٥٠")).toBe(123_450);
    expect(parseMoneyMinor(" 18 ")).toBe(1_800);
    expect(parseMoneyMinor("-12.5")).toBe(-1_250);
  });

  it("الخانةُ الفارغة والغائبة null — لا صفر", () => {
    expect(parseMoneyMinor(undefined)).toBeNull();
    expect(parseMoneyMinor("")).toBeNull();
    expect(parseMoneyMinor("   ")).toBeNull();
  });

  it("والصفرُ المكتوب صفرٌ — غيرُ الفارغ", () => {
    expect(parseMoneyMinor("0")).toBe(0);
    expect(parseMoneyMinor("0.00")).toBe(0);
  });

  it("ما لا يُمثَّل بالهللات لا يُقرَّب", () => {
    expect(parseMoneyMinor("3.3913")).toBeNull();
    expect(parseMoneyMinor("12.345")).toBeNull();
    expect(parseMoneyMinor("12.340")).toBe(1_234);
    expect(parseMoneyMinor("abc")).toBeNull();
    expect(parseMoneyMinor("12a")).toBeNull();
    expect(parseMoneyMinor("-")).toBeNull();
  });
});

describe("parseQuantityMilli", () => {
  it("الكمّيّةُ بالمِلّي، والفارغُ null", () => {
    expect(parseQuantityMilli("2")).toBe(2_000);
    expect(parseQuantityMilli("0.333")).toBe(333);
    expect(parseQuantityMilli("١٫٥")).toBe(1_500);
    expect(parseQuantityMilli("1,000")).toBe(1_000_000);
    expect(parseQuantityMilli("")).toBeNull();
    expect(parseQuantityMilli(undefined)).toBeNull();
    expect(parseQuantityMilli("كثير")).toBeNull();
  });
});

describe("readSalesAmount", () => {
  it("الفارغُ غيرُ ما لا يُقرأ", () => {
    expect(readSalesAmount(undefined)).toEqual({ state: "EMPTY" });
    expect(readSalesAmount("")).toEqual({ state: "EMPTY" });
    expect(readSalesAmount("-")).toEqual({ state: "EMPTY" });
    expect(readSalesAmount("—")).toEqual({ state: "EMPTY" });
    expect(readSalesAmount("n/a")).toEqual({ state: "UNREADABLE" });
    expect(readSalesAmount("12.5.1")).toEqual({ state: "UNREADABLE" });
  });

  it("يقرأ خمس منازل بلا عائمة — ضريبةُ فودكس 3.3913", () => {
    expect(readSalesAmount("3.3913")).toEqual({ state: "OK", micro: 339_130 });
    expect(readSalesAmount("26")).toEqual({ state: "OK", micro: 2_600_000 });
    expect(readSalesAmount("-3.3913")).toEqual({ state: "OK", micro: -339_130 });
    expect(readSalesAmount("1,234.5 SAR")).toEqual({ state: "OK", micro: 123_450_000 });
    expect(readSalesAmount("٢٦٫٥ ريال")).toEqual({ state: "OK", micro: 2_650_000 });
    // السادسةُ تقرّب الخامسة
    expect(readSalesAmount("0.000015")).toEqual({ state: "OK", micro: 2 });
    expect(readSalesAmount("0.000014")).toEqual({ state: "OK", micro: 1 });
  });

  it("المجموعُ يُقرَّب مرّةً: ثلاثُ ضرائب 3.3913 = 10.17 لا 10.20", () => {
    const one = readSalesAmount("3.3913");
    if (one.state !== "OK") throw new Error("لم تُقرأ");
    expect(microToMinor(one.micro * 3)).toBe(1_017);
    expect(microToMinor(one.micro) * 3).toBe(1_017);
    // والنصفُ بعيداً عن الصفر في الطرفين
    expect(microToMinor(500)).toBe(1);
    expect(microToMinor(-500)).toBe(-1);
    expect(microToMinor(499)).toBe(0);
  });
});

describe("parseSourceCostMinor", () => {
  it("كلفةُ فودكس بخمس منازل تُقرَّب — وهي إعلاميّة", () => {
    expect(parseSourceCostMinor("2.92246")).toBe(292);
    expect(parseSourceCostMinor("١٫٥")).toBe(150);
    expect(parseSourceCostMinor("0")).toBe(0);
  });

  it("الفارغُ وما لا يُقرأ null", () => {
    expect(parseSourceCostMinor(undefined)).toBeNull();
    expect(parseSourceCostMinor("")).toBeNull();
    expect(parseSourceCostMinor("-")).toBeNull();
    expect(parseSourceCostMinor("2.9x")).toBeNull();
  });
});

describe("detectDateOrder / parseBusinessDate", () => {
  it("صفٌّ واحد يتجاوز ١٢ يقطع بالترتيب للملفّ كلّه", () => {
    expect(detectDateOrder(["03/09/2026", "13/09/2026"])).toBe("DMY");
    expect(detectDateOrder(["9/3/26", "9/19/26"])).toBe("MDY");
    expect(detectDateOrder(["03/09/2026", "04/09/2026"])).toBe("AMBIGUOUS");
    expect(detectDateOrder(["13/09/2026", "09/19/2026"])).toBe("AMBIGUOUS");
    expect(detectDateOrder(["2026-09-03 10:00:00"])).toBe("ISO");
    expect(detectDateOrder([])).toBe("AMBIGUOUS");
    // والوقتُ الملتصق بالتاريخ لا يُضيع الدليل
    expect(detectDateOrder(["3/9/2026 14:30", "13/9/2026 09:05"])).toBe("DMY");
    expect(detectDateOrder(["9/3/26 10:05", "9/19/26 10:05"])).toBe("MDY");
  });

  it("يقرأ الصيغ الثلاث ويردّ اليومَ المستحيل", () => {
    expect(parseBusinessDate("2026-09-01")).toBe("2026-09-01");
    expect(parseBusinessDate("2026-09-01 23:59:59")).toBe("2026-09-01");
    expect(parseBusinessDate("9/19/26", "MDY")).toBe("2026-09-19");
    expect(parseBusinessDate("3/9/2026", "DMY")).toBe("2026-09-03");
    expect(parseBusinessDate("3/9/2026", "MDY")).toBe("2026-03-09");
    // السنةُ بأربع خاناتٍ تُقرأ كاملةً — كانت تُقصّ إلى «20» فتصير ٢٠٢٠
    expect(parseBusinessDate("19/09/2026 14:30", "DMY")).toBe("2026-09-19");
    expect(parseBusinessDate("1/1/1999", "DMY")).toBe("1999-01-01");
    expect(parseBusinessDate("1/1/99", "DMY")).toBe("1999-01-01");
    expect(parseBusinessDate("9/19/26 10:05", "MDY")).toBe("2026-09-19");
    expect(parseBusinessDate("2026-9-1 14:30")).toBe("2026-09-01");
    expect(parseBusinessDate("2026-09-01T14:30:00Z")).toBe("2026-09-01");
    expect(parseBusinessDate("19 / 09 / 2026", "DMY")).toBe("2026-09-19");
    // وسنةٌ من ثلاث خاناتٍ أو خمس لا تُحزَر
    expect(parseBusinessDate("3/9/202", "DMY")).toBeNull();
    expect(parseBusinessDate("3/9/20261", "DMY")).toBeNull();
    // ما جاوز ١٢ يقطع بنفسه ولو خالف افتراضَ الملفّ
    expect(parseBusinessDate("19/9/2026", "MDY")).toBe("2026-09-19");
    expect(parseBusinessDate("٢٠٢٦-٠٩-٠١")).toBe("2026-09-01");
    expect(parseBusinessDate("2026-02-30")).toBeNull();
    expect(parseBusinessDate("31/02/2026", "DMY")).toBeNull();
    expect(parseBusinessDate("")).toBeNull();
    expect(parseBusinessDate(undefined)).toBeNull();
    expect(parseBusinessDate("أمس")).toBeNull();
  });

  it("رقمُ إكسل التسلسليّ يومٌ لا منطقةَ فيه", () => {
    // ١ سبتمبر ٢٠٢٦ = 46266
    expect(parseBusinessDate("46266")).toBe("2026-09-01");
    expect(parseBusinessDate("46266.9999")).toBe("2026-09-01");
    expect(parseBusinessDate("12345")).toBeNull();
  });
});

describe("parseSoldAt", () => {
  it("بلا وقتٍ: منتصفُ يوم العمل — فالترتيبُ يبقى مستقيماً ولا ينزلق اليوم", () => {
    expect(parseSoldAt(undefined, "2026-09-01").toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(parseSoldAt("", "2026-09-01").toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(parseSoldAt("9/1/26", "2026-09-01").toISOString()).toBe("2026-09-01T12:00:00.000Z");
  });

  it("الوقتُ المكتوب يُحمَل على يوم العمل لا على تاريخ الخانة", () => {
    expect(parseSoldAt("2026-09-01 14:30:05", "2026-09-01").toISOString()).toBe("2026-09-01T14:30:05.000Z");
    expect(parseSoldAt("٩:٠٥", "2026-09-01").toISOString()).toBe("2026-09-01T09:05:00.000Z");
    // بيعةُ ما بعد منتصف الليل تبقى في يوم عملها
    expect(parseSoldAt("2026-09-02 00:40", "2026-09-01").toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("حافّتا اليوم لا تخرجان منه", () => {
    expect(parseSoldAt("00:00:00", "2026-08-31").toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(parseSoldAt("23:59:59", "2026-08-31").toISOString()).toBe("2026-08-31T23:59:59.000Z");
  });
});
