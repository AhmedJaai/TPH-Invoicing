import { describe, expect, it } from "vitest";
import { latinDigits } from "./digits";
import { parseRiyals } from "./money";
import { parseAmountToMinor } from "./bank/vision-statement";
import { normalizeDigits } from "./search";

describe("الأرقامُ إلى اللاتينيّة — موضعٌ واحد", () => {
  /* كما كانت في money · line-pricing · items · invoice-number · validation · units */
  const oldTwoPass = (v: string) => v
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  /* كما كانت في search · bank/vision-statement · inventory/purchase-link */
  const oldArabicOnly = (v: string) => v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

  const samples = [
    "", "410.00", "٠١٢٣٤٥٦٧٨٩", "۰۱۲۳۴۵۶۷۸۹", "١٬٢٣٤٫٥٠", "فاتورة رقم ٤٥٧ / INV-۲۰۲٦", "٣١٠٠٠٧٩٧١٦٠٠٠٠٣",
    "12 × ٥٠٠ مل", "بلا أرقام", "٢٠٢٦-٠٩-٣٠", "1۲3", "SR ١٬١٥١٫١٥",
  ];

  it("يطابق الصيغةَ ذاتَ المرّتين حرفاً بحرف", () => {
    for (const s of samples) expect(latinDigits(s)).toBe(oldTwoPass(s));
  });

  it("وما لا فارسيّةَ فيه يطابق الصيغةَ العربيّة وحدها", () => {
    for (const s of samples.filter((x) => !/[۰-۹]/.test(x))) expect(latinDigits(s)).toBe(oldArabicOnly(s));
  });

  it("لا يمسّ الفواصل ولا الحروف", () => {
    expect(latinDigits("١٬٢٣٤٫٥٠ ريال")).toBe("1٬234٫50 ريال");
  });

  it("المال يُقرأ كما كان", () => {
    expect(parseRiyals("١٬٢٣٤٫٥٠")).toBe(123_450);
    expect(parseRiyals("۴۱۰")).toBe(41_000);
  });

  /* الفرقُ الوحيد: الفارسيّةُ تُقرأ حيث كانت تسقط بصمت */
  it("مبلغُ كشفٍ مصوَّر فيه خانةٌ فارسيّة لا تسقط خانتُه", () => {
    expect(parseAmountToMinor("1۲3.00")).toBe(12_300);
    expect(parseAmountToMinor("١٢٣٫٥٠")).toBe(12_350);
    expect(normalizeDigits("۱۲۳")).toBe("123");
  });
});
