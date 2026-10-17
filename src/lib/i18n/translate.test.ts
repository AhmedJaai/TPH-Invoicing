import { describe, expect, it } from "vitest";
import { Translator, latinize } from "./translate";

const t = new Translator({
  "الفواتير": "Invoices",
  "المورّد": "Supplier",
  "احفظ": "Save",
  "{0} فواتير تنتظر": "{0} invoices waiting",
  "دفعت {0} لـ{1}": "You paid {1} {0}",
  "لم تُقرأ": "Not read",
  "ريال": "SAR",
});

describe("ترجمة الواجهة", () => {
  it("النصّ كاملاً، ومسافاته في طرفيه تبقى", () => {
    expect(t.translate("الفواتير")).toBe("Invoices");
    expect(t.translate("  احفظ ")).toBe("  Save ");
    expect(t.translate("الفواتير\n   ")).toBe("Invoices\n   ");
  });

  it("القالب يأخذ قيمه، والأرقام الهنديّة تصير لاتينيّة", () => {
    expect(t.translate("٣ فواتير تنتظر")).toBe("3 invoices waiting");
    expect(t.translate("١٬٢٥٠ فواتير تنتظر")).toBe("1,250 invoices waiting");
  });

  it("وقيمةٌ عربيّة في القالب تُترجَم وحدها، وترتيبُ الخانات يُحترَم", () => {
    expect(t.translate("دفعت ٥٠ لـالمورّد")).toBe("You paid Supplier 50");
  });

  it("ما لا يُعرف يبقى كما هو — اسمُ مورّدٍ لا تُخترَع ترجمته", () => {
    expect(t.translate("مؤسسة الغربية")).toBe("مؤسسة الغربية");
  });

  it("المركّب بالفواصل يُترجم جزءاً جزءاً", () => {
    expect(t.translate("الفواتير — لم تُقرأ")).toBe("Invoices — Not read");
    expect(t.translate("الفواتير · مؤسسة الغربية")).toBe("Invoices · مؤسسة الغربية");
  });

  it("رقمٌ ملتصق بنصٍّ معروف", () => {
    expect(t.translate("١٢٠ ريال")).toBe("120 SAR");
  });

  it("النصّ بلا عربيّة يمرّ بأرقامه لاتينيّة", () => {
    expect(t.translate("١٢٫٥٪")).toBe("12.5%");
    expect(latinize("«أ»، ب؟")).toBe("\"أ\", ب?");
  });
});

describe("حدود القوالب", () => {
  const t2 = new Translator({ "ال{0}": "the {0}", "السبت": "Saturday", "أكتوبر": "October", "قواعد التصنيف": "Classification rules" });
  it("قالبٌ ثابتُه أقلّ من ثلاثة أحرف لا يُطبَّق — التاريخ يُترجَم جزءاً جزءاً", () => {
    expect(t2.translate("السبت، ١٧ أكتوبر")).toBe("Saturday, 17 October");
  });
  it("واو العطف تُترجَم وما بعدها معروف", () => {
    expect(t2.translate("وقواعد التصنيف")).toBe("and Classification rules");
  });
});

describe("قوالب بلا طرفٍ يُفهرَس، والتواريخ القصيرة", () => {
  const t3 = new Translator({ "{0} من {1} لها بنود ({2})": "{0} of {1} have lines ({2})", "لا فواتير": "no invoices", "أكتوبر": "October" });
  it("قالبٌ يبدأ بخانة وينتهي بحرفٍ واحد يُطابَق", () => {
    expect(t3.translate("٠ من لا فواتير لها بنود (٠٪)")).toBe("0 of no invoices have lines (0%)");
  });
  it("مدى تاريخٍ قصير يُترجَم كلمةً كلمة", () => {
    expect(t3.translate("٤–١٠ أكتوبر ٢٠٢٦")).toBe("4–10 October 2026");
    expect(t3.translate("مؤسسة ١٠ أكتوبر")).toBe("مؤسسة ١٠ أكتوبر");
  });
});

describe("خانة أخيرة فارغة", () => {
  const t4 = new Translator({ "تُنشئ الوصفات دفعة واحدة{0}.": "Creates recipes in one go{0}." });
  it("النصّ بلا قيمته الأخيرة يُترجَم", () => {
    expect(t4.translate("تُنشئ الوصفات دفعة واحدة.")).toBe("Creates recipes in one go.");
  });
});
