import { describe, expect, it } from "vitest";
import { checkInvoiceTotals, parseRiyals, TOTAL_ROUNDING_TOLERANCE_MINOR } from "./money";

/**
 * سلوكٌ كانت تنجو فيه طفراتُ Stryker (`npm run test:mutation`) — أي لا اختبار يقوله.
 * كلُّ حالةٍ هنا لو انكسرت لقُبل مبلغٌ خاطئ أو رُدّ مبلغٌ صحيح.
 */
describe("parseRiyals — حدودٌ لم تكن مختبَرة", () => {
  it("«ر س» بلا نقطة، و«ر. س» بفراغٍ بعد النقطة — عملةٌ تُسقَط لا مبلغٌ يُردّ", () => {
    expect(parseRiyals("100 ر س")).toBe(10_000);
    expect(parseRiyals("100 رس")).toBe(10_000);
    expect(parseRiyals("100 ر. س")).toBe(10_000);
  });

  it("ثلاثُ منازل آخرُها صفر تُقبل وحدها — لا ما قبلها حرفٌ غريب ولا ما بعدها رقمٌ رابع", () => {
    expect(parseRiyals("437.000")).toBe(43_700);
    expect(parseRiyals("x437.000")).toBeNull();
    expect(parseRiyals("437.0005")).toBeNull();
  });
});

describe("checkInvoiceTotals — الخصم والرسوم بعد الضريبة", () => {
  /* الصافي + الضريبة = ١١٥٠، والمطبوع ١٠٥٠: فرقُ ١٠٠ ريال */
  const sub = 1_000_00;
  const vat = 150_00;

  it("خصمٌ سالبٌ أو صفرٌ مقروء لا يفسّر فرقاً — لا يصير «رسوماً» مقلوبة", () => {
    /* المطبوعُ أكبر بـ٥٠٠ ريال، وقُرئ «خصمٌ» −٥٠٠: لا يُقبل تفسيراً */
    expect(checkInvoiceTotals(sub, vat, 1_650_00, { discountMinor: -500_00 }).verdict).toBe("MISMATCH");
    expect(checkInvoiceTotals(sub, vat, 650_00, { chargesMinor: -500_00 }).verdict).toBe("MISMATCH");
  });

  it("فرقٌ يساوي الخصمَ زائد التسامح بالضبط يُقبل — والحدّ شاملٌ كما في القاعدة", () => {
    /* الفرقُ ١٠١ ريال، والخصمُ ١٠٠: يبقى ريالٌ — هو التسامحُ بالضبط */
    const r = checkInvoiceTotals(sub, vat, 1_050_00 - TOTAL_ROUNDING_TOLERANCE_MINOR, { discountMinor: 100_00 });
    expect(r).toEqual({ verdict: "ADJUSTED", discountMinor: 100_00, chargesMinor: null });
  });

  it("قُرئ خصمٌ ورسوم، والخصمُ وحده يفسّر الفرق — يُحفظ الخصم وحده لا الاثنان", () => {
    const r = checkInvoiceTotals(sub, vat, 1_050_00, { discountMinor: 100_00, chargesMinor: 30_00 });
    expect(r).toEqual({ verdict: "ADJUSTED", discountMinor: 100_00, chargesMinor: null });
  });

  it("والرسومُ وحدها حين تفسّره هي — لا يُنسب إلى خصمٍ لم يقع", () => {
    const r = checkInvoiceTotals(sub, vat, 1_175_00, { discountMinor: 300_00, chargesMinor: 25_00 });
    expect(r).toEqual({ verdict: "ADJUSTED", discountMinor: null, chargesMinor: 25_00 });
  });
});
