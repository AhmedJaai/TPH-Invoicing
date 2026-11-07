import { describe, expect, it } from "vitest";
import { teamCountReport, whatsappNumber } from "./team-report";

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
