import { describe, expect, it } from "vitest";
import { countedText, teamCountReport, whatsappNumber } from "./team-report";

describe("teamCountReport", () => {
  const text = teamCountReport({
    week: { start: "2026-11-01", end: "2026-11-07" }, by: "أنس",
    lines: [
      { name: "Blend fusion", categoryLabel: "البن", counted: "2500 جرام" },
      { name: "Milk", categoryLabel: "الألبان", counted: "12 لتر" },
      { name: "China", categoryLabel: "البن", counted: null },
    ],
  });
  it("يقول الأسبوعَ ومن عدّ وكم عُدّ، ويجمع الأصنافَ بفئتها", () => {
    expect(text).toContain("أسبوع 1 نوفمبر إلى 7 نوفمبر");
    expect(text).toContain("عدّه: أنس");
    expect(text).toContain("عُدّ 2 من 3 أصناف");
    expect(text).toContain("*البن*\n• Blend fusion: 2500 جرام");
    expect(text).toContain("• Milk: 12 لتر");
  });
  it("وما لم يُعَدّ يُسمّى ولا يُكتب صفراً", () => {
    expect(text).toContain("*لم يُعَدّ (1)*\n• China");
    expect(text).not.toContain("China: 0");
  });
});

describe("whatsappNumber", () => {
  it("يقرأ الصيغ السعوديّة الشائعة", () => {
    expect(whatsappNumber("0551234567")).toBe("966551234567");
    expect(whatsappNumber("+966 55 123 4567")).toBe("966551234567");
    expect(whatsappNumber("00966551234567")).toBe("966551234567");
    expect(whatsappNumber("٠٥٥١٢٣٤٥٦٧")).toBe("966551234567");
    expect(whatsappNumber("551234567")).toBe("966551234567");
  });
  it("وما لا يُقرأ رقماً `null`", () => {
    expect(whatsappNumber("123")).toBeNull();
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
});

describe("countedText", () => {
  it("يقول ما كُتب ومجموعَه، ولا يكرّر تفصيلاً يساويه", () => {
    expect(countedText({ name: "اكواب", categoryLabel: "التغليف", counted: "10397 حبّة", entered: "19 كرتون + 897 حبّة" })).toBe("19 كرتون + 897 حبّة = 10397 حبّة");
    expect(countedText({ name: "سكر", categoryLabel: "أخرى", counted: "500 جرام", entered: "500 جرام" })).toBe("500 جرام");
    expect(countedText({ name: "سكر", categoryLabel: "أخرى", counted: null, entered: null })).toBeNull();
  });
});

describe("ما يُقارَن وما يُحفظ", () => {
  it("أصنافُ المالك أوّلاً، وما عدّه الفريقُ خارجها تحت «للحفظ فقط»", () => {
    const text = teamCountReport({
      week: { start: "2026-11-01", end: "2026-11-07" }, by: "أنس",
      lines: [
        { name: "مناديل", categoryLabel: "أخرى", counted: "8 حبّة", inScope: false },
        { name: "Yemen", categoryLabel: "أخرى", counted: "569 جرام", inScope: true },
      ],
    });
    expect(text.indexOf("• Yemen")).toBeLessThan(text.indexOf("• مناديل"));
    expect(text).toContain("*للحفظ فقط · أخرى*\n• مناديل: 8 حبّة");
  });
});
