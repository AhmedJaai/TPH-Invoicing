import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  formatRiyals, formatRiyalsDisplay, HALALAS_PER_RIYAL, MAX_AMOUNT_MINOR, MILLI_MINOR,
  milliMinorToMinor, parseRiyals,
} from "./money";

/**
 * خصائصُ المال — «المجهول ليس صفراً» مكتوبةً قانوناً لا مثالاً.
 *
 * كلُّ عددٍ في مدى عمود المال يذهب نصّاً ويعود هو نفسُه، وكلُّ نصٍّ — مفهوماً أو
 * عبثاً — إمّا هللاتٌ صحيحة داخل المدى أو `null`. ولا ثالث: لا `NaN`، ولا كسر،
 * ولا صفرٌ عن نصٍّ ليس فيه صفر.
 */
const RUNS = { numRuns: 2000, seed: 20261010 };
const minor = fc.integer({ min: -MAX_AMOUNT_MINOR, max: MAX_AMOUNT_MINOR });

const toIndic = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
const toPersian = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));

describe("parseRiyals ↔ formatRiyals — خصائص", () => {
  it("كلُّ مبلغٍ في المدى يذهب نصّاً ويعود بالهللة", () => {
    fc.assert(fc.property(minor, (n) => {
      expect(parseRiyals(formatRiyals(n))).toBe(n);
      expect(parseRiyals(formatRiyalsDisplay(n))).toBe(n);
    }), RUNS);
  });

  it("الأرقامُ العربيّة والفارسيّة وفواصلُها تُقرأ كاللاتينيّة", () => {
    fc.assert(fc.property(minor, (n) => {
      const display = formatRiyalsDisplay(n);
      const arabic = toIndic(display).replace(/,/g, "٬").replace(".", "٫");
      expect(parseRiyals(arabic)).toBe(n);
      expect(parseRiyals(toPersian(display))).toBe(n);
      expect(parseRiyals(`  ${display} SR `)).toBe(n);
      expect(parseRiyals(`${display} ريال`)).toBe(n);
    }), RUNS);
  });

  it("ما جاوز عمودَ المال «لم يُقرأ» لا رقماً يُسقط الكتابة", () => {
    fc.assert(fc.property(fc.integer({ min: MAX_AMOUNT_MINOR + 1, max: Number.MAX_SAFE_INTEGER }), (n) => {
      expect(parseRiyals(formatRiyals(n))).toBeNull();
      expect(parseRiyals(formatRiyals(-n))).toBeNull();
    }), RUNS);
  });

  /* نصوصٌ من حروف المبالغ نفسها: أقربُ العبث إلى أن يُقبَل خطأً */
  const moneyish = fc.string({
    unit: fc.constantFrom(..."0123456789٠١٢٣٤٥٦٧٨٩۰۱۲۳.,٬٫- SRريالس﷼xe+".split("")),
    maxLength: 14,
  });

  it("أيُّ نصٍّ: هللاتٌ صحيحة داخل المدى أو null — ولا ثالث", () => {
    fc.assert(fc.property(fc.oneof(moneyish, fc.string({ maxLength: 20 })), (text) => {
      const got = parseRiyals(text);
      if (got === null) return;
      expect(Number.isSafeInteger(got)).toBe(true);
      expect(Math.abs(got)).toBeLessThanOrEqual(MAX_AMOUNT_MINOR);
      // ما قُبل يُكتَب ويُقرأ هو نفسُه: لا معنى ثانٍ للنصّ
      expect(parseRiyals(formatRiyals(got))).toBe(got);
    }), RUNS);
  });

  it("لا صفرَ عن نصٍّ ليس فيه صفر، ولا مبلغَ عن نصٍّ بلا رقم", () => {
    fc.assert(fc.property(fc.oneof(moneyish, fc.string({ maxLength: 20 })), (text) => {
      const got = parseRiyals(text);
      if (got === null) return;
      expect(/[0-9٠-٩۰-۹]/.test(text)).toBe(true);
      if (got === 0) expect(/[0٠۰]/.test(text)).toBe(true);
    }), RUNS);
  });

  it("المنزلةُ الثالثة تُقبَل صفراً وحده — وغيرُه لا يُقرَّب", () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 20_000_000 }), fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 9 }),
      (whole, cents, third) => {
        const text = `${whole}.${String(cents).padStart(2, "0")}${third}`;
        const want = third === 0 ? whole * HALALAS_PER_RIYAL + cents : null;
        expect(parseRiyals(text)).toBe(want);
      },
    ), RUNS);
  });
});

describe("milliMinorToMinor", () => {
  it("يقرّب مرّةً واحدة، والنصفُ إلى أعلى", () => {
    expect(milliMinorToMinor(0)).toBe(0);
    expect(milliMinorToMinor(499)).toBe(0);
    expect(milliMinorToMinor(500)).toBe(1);
    expect(milliMinorToMinor(501)).toBe(1);
    expect(milliMinorToMinor(1_499)).toBe(1);
    expect(milliMinorToMinor(1_500)).toBe(2);
    // المصّاصة: ‏٢٫١٢٥ هللة للحبّة، وأربعةُ آلافٍ منها ٨٥ ريالاً بالضبط
    expect(milliMinorToMinor(2_125)).toBe(2);
    expect(milliMinorToMinor(2_125 * 4_000)).toBe(8_500);
  });

  it("السالبُ مرآةُ الموجب — مرتجعٌ بنصف هللةٍ لا يُقرَّب بغير ما قُرِّب به شراؤه", () => {
    expect(milliMinorToMinor(-500)).toBe(-1);
    expect(milliMinorToMinor(-1_500)).toBe(-2);
    expect(milliMinorToMinor(-499)).toBe(0);
    // لا «سالبَ صفر»: يُكتَب ويُقارَن صفراً
    expect(Object.is(milliMinorToMinor(-499), 0)).toBe(true);
    expect(Object.is(milliMinorToMinor(-1), 0)).toBe(true);
  });

  it("خاصّيّة: متماثلٌ حول الصفر، وخطؤه نصفُ هللةٍ على الأكثر", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: MAX_AMOUNT_MINOR * MILLI_MINOR }), (m) => {
      const up = milliMinorToMinor(m);
      const down = milliMinorToMinor(-m);
      expect(Number.isInteger(up)).toBe(true);
      expect(up + down).toBe(0);
      expect(Math.abs(up * MILLI_MINOR - m)).toBeLessThanOrEqual(MILLI_MINOR / 2);
    }), RUNS);
  });

  it("خاصّيّة: مضاعفاتُ الألف تعود هللاتِها بالضبط", () => {
    fc.assert(fc.property(minor, (n) => {
      expect(milliMinorToMinor(n * MILLI_MINOR)).toBe(n);
    }), RUNS);
  });
});
