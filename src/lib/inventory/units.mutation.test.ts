import { describe, expect, it } from "vitest";
import { ambiguousThousandsMessage, decimalToMilli, isAmbiguousThousands, milliToDecimal } from "./units";

/** حدودُ قراءة الكمّيّة التي كانت تنجو فيها طفراتُ Stryker — كلٌّ منها كمّيّةٌ خاطئة في الجرد. */
describe("decimalToMilli — ما ليس عدداً لا يصير عدداً", () => {
  it("حرفٌ قبل الرقم يُردّ «لم يُقرأ» لا يُقرأ آخرُه", () => {
    expect(decimalToMilli("abc5")).toBeNull();
    expect(decimalToMilli("كجم 5")).toBeNull();
  });

  it("رقمٌ لا يتّسع له عددٌ صحيحٌ آمن يُردّ", () => {
    expect(decimalToMilli("99999999999999999999")).toBeNull();
  });

  it("NaN واللانهاية من جدولٍ مستورد تُردّ — لا تصير NaN في الجرد", () => {
    expect(decimalToMilli(Number.NaN)).toBeNull();
    expect(decimalToMilli(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("فاصلةُ الآلاف الملتبسة", () => {
  it("«−5,200» ملتبسةٌ كموجبها", () => {
    expect(isAmbiguousThousands("-5,200")).toBe(true);
    expect(isAmbiguousThousands(" +5,200 ")).toBe(true);
  });

  it("ما سبقه أو لحقه حرفٌ، أو بعد فاصلته أربعُ خانات — ليس الشكلَ الملتبس", () => {
    expect(isAmbiguousThousands("a5,200")).toBe(false);
    expect(isAmbiguousThousands("5,200x")).toBe(false);
    expect(isAmbiguousThousands("5,2000")).toBe(false);
  });

  it("الرسالةُ تعرض القراءتين بلا إشارةٍ ولا فراغ", () => {
    expect(ambiguousThousandsMessage("  -5,200  ")).toBe(
      "«-5,200» تحتمل قراءتين: 5.200 أم 5200؟ اكتبها بنقطة عشرية أو بدون فاصلة",
    );
    expect(ambiguousThousandsMessage("١,٢٣٤")).toContain(": 1.234 أم 1234؟");
  });
});

describe("milliToDecimal", () => {
  it("الصفرُ «0.000» لا «-0.000»", () => {
    expect(milliToDecimal(0)).toBe("0.000");
    expect(milliToDecimal(-1)).toBe("-0.001");
  });
});
