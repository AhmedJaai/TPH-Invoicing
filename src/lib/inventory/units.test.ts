import { describe, expect, it } from "vitest";
import { canonicalToQuantity, convertMilli, decimalToMilli, formatQuantity, formatSignedQuantity, fromCanonical, milliToDecimal, sameUnitFamily, toCanonical, unitChoices, unitFamily } from "./units";

/**
 * الوحدةُ الداخليّة: مِلّي من أصغر وحدةٍ في العائلة.
 *
 * والاختبارُ هنا يحرس ما لا يراه المترجم: أنّ ١٠٠ × ٢٠ جراماً **٢ كجم
 * بالضبط** لا `1.9999999999999998`. وذلك يقع حين يُضرَب كسرٌ عشريّ ألفَ
 * مرّة، وهو ما يفعله الجرد في كلّ أسبوع.
 */
describe("التحويل المعياريّ", () => {
  it("٢٬٠٠٠ جرام = ٢ كيلو — بالضبط", () => {
    const grams = toCanonical(2000 * 1000, "G"); // ٢٬٠٠٠ جرام بالمِلّي
    const asKg = canonicalToQuantity(grams, "KG");
    expect(asKg).toBe(2);
    expect(formatQuantity(grams, "KG")).toBe("2 كيلو");
  });

  it("١٠٠ مشروبٍ × ٢٠ جراماً = ٢ كجم — بلا كسرٍ عائمٍ متراكم", () => {
    /* كما يحسبها المحرّك: (كمّيّة بالمِلّي × كمّيّة المكوّن بالمِلّي) ÷ الناتج */
    const sold = 100 * 1000;
    const perDrink = 20 * 1000;
    const canonical = toCanonical((sold * perDrink) / 1000, "G");
    expect(canonical).toBe(2_000_000);
    expect(Number.isInteger(canonical)).toBe(true);
    expect(canonicalToQuantity(canonical, "KG")).toBe(2);
  });

  it("١ كيلو = ١٬٠٠٠٬٠٠٠ مِلّي‑جرام، و١ لتر = ١٬٠٠٠٬٠٠٠ مِلّي‑مليلتر", () => {
    expect(toCanonical(1000, "KG")).toBe(1_000_000);
    expect(toCanonical(1000, "L")).toBe(1_000_000);
    expect(toCanonical(1000, "G")).toBe(1000);
    expect(toCanonical(1000, "ML")).toBe(1000);
  });

  it("والعكس يعيد ما دخل", () => {
    expect(fromCanonical(1_000_000, "KG")).toBe(1000);
    expect(fromCanonical(18_000, "G")).toBe(18_000);
  });
});

describe("لا جسرَ بين العائلات", () => {
  it("الوزنُ لا يصير حجماً — ولا معامِلَ كثافةٍ مخترَع", () => {
    expect(convertMilli(1000, "KG", "L")).toBeNull();
    expect(convertMilli(1000, "ML", "G")).toBeNull();
    expect(sameUnitFamily("KG", "L")).toBe(false);
  });

  it("والحبّةُ ليست عبوة — عائلتان، كما في `unit-conversion.convert`", () => {
    expect(unitFamily("PIECE")).not.toBe(unitFamily("PACK"));
    expect(convertMilli(1000, "PACK", "PIECE")).toBeNull();
  });

  it("وداخل العائلة يصحّ", () => {
    expect(convertMilli(2000, "KG", "G")).toBe(2_000_000);
    expect(convertMilli(2_000_000, "G", "KG")).toBe(2000);
    expect(convertMilli(1500, "L", "ML")).toBe(1_500_000);
  });
});

describe("العدد العشريّ يُقرأ حروفاً لا بالفاصلة العائمة", () => {
  it("«0.333» = ٣٣٣ — لا 333.00000000000006", () => {
    expect(decimalToMilli("0.333")).toBe(333);
    expect(Number.isInteger(decimalToMilli("0.333")!)).toBe(true);
  });

  it("يقبل الفاصلة والصفر والسالب", () => {
    expect(decimalToMilli("10.5")).toBe(10_500);
    expect(decimalToMilli("10,5")).toBe(10_500);
    expect(decimalToMilli("0")).toBe(0);
    expect(decimalToMilli("-2.5")).toBe(-2500);
    expect(decimalToMilli(".5")).toBe(500);
    expect(decimalToMilli("7")).toBe(7000);
  });

  it("والخانةُ الرابعة تُقرِّب ولا تُقصّ — القصُّ يُنقص دائماً", () => {
    expect(decimalToMilli("0.0006")).toBe(1);
    expect(decimalToMilli("1.9999")).toBe(2000);
  });

  it("وما ليس عدداً يُرجع `null` — لا صفراً", () => {
    expect(decimalToMilli("")).toBeNull();
    expect(decimalToMilli("غير معروف")).toBeNull();
    expect(decimalToMilli(null)).toBeNull();
    expect(decimalToMilli(undefined)).toBeNull();
    expect(decimalToMilli("12kg")).toBeNull();
  });

  it("ويُكتَب إلى عمود numeric(…,3) بثلاث خانات", () => {
    expect(milliToDecimal(2500)).toBe("2.500");
    expect(milliToDecimal(1)).toBe("0.001");
    expect(milliToDecimal(-2500)).toBe("-2.500");
  });
});

describe("العرض", () => {
  it("المجهولُ يُكتب «غير معروف» لا صفراً", () => {
    expect(formatQuantity(null, "KG")).toBe("غير معروف");
    expect(formatSignedQuantity(null, "KG")).toBe("غير معروف");
  });

  it("والفرقُ يُقرأ باتّجاهه قبل مقداره", () => {
    expect(formatSignedQuantity(-2_500_000, "KG")).toBe("−2.5 كيلو");
    expect(formatSignedQuantity(2_500_000, "KG")).toBe("+2.5 كيلو");
    expect(formatSignedQuantity(0, "KG")).toBe("0 كيلو");
  });
});

describe("يُعَدّ بالوحدة التي يُوزَن بها", () => {
  /*
    وحدةُ الصنف في الكتالوج وحدةُ صرفه — البنُّ بالجرام لأنّ الوصفة
    تقول «٢٠ جراماً». والميزانُ يقول «٥٫٢ كجم». فلو لزمت الصغرى لكُتب
    «٥٢٠٠»، وخطأُ صفرٍ واحد فرقٌ بعشرة أضعاف لا يُرى إلّا في التقرير.
  */
  it("الوزنُ جرامٌ وكيلو، والحجمُ مليلترٌ ولتر", () => {
    expect(unitChoices("G")).toEqual(["G", "KG"]);
    expect(unitChoices("KG")).toEqual(["G", "KG"]);
    expect(unitChoices("ML")).toEqual(["ML", "L"]);
    expect(unitChoices("L")).toEqual(["ML", "L"]);
  });

  /* ولا معامِلَ بين حبّةٍ وعبوة، فلا خيارَ فيهما */
  it("وما لا ثانيَ له تبقى وحدتُه وحدها", () => {
    expect(unitChoices("PIECE")).toEqual(["PIECE"]);
    expect(unitChoices("PACK")).toEqual(["PACK"]);
  });

  it("والرقمُ المكتوب بالكيلو يصير مِلّي‑جرامٍ في الخادم", () => {
    /* ‏٥٫٢ كجم */
    expect(toCanonical(decimalToMilli("5.2")!, "KG")).toBe(5_200_000);
    /* وهو عينُ ٥٢٠٠ جراماً */
    expect(toCanonical(decimalToMilli("5200")!, "G")).toBe(5_200_000);
  });
});
