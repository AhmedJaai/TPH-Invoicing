import { describe, expect, it } from "vitest";
import { formatRiyals, formatRiyalsDisplay, parseRiyals } from "./money";

describe("تحويل المبالغ", () => {
  it("يقرأ الأرقام اللاتينية", () => {
    expect(parseRiyals("410.00")).toBe(41_000);
    expect(parseRiyals("410")).toBe(41_000);
    expect(parseRiyals("17,572.00")).toBe(1_757_200);
    expect(parseRiyals("4151.50")).toBe(415_150);
  });

  it("يقرأ الأرقام العربية الهندية وفواصلها", () => {
    expect(parseRiyals("٤١٠٫٠٠")).toBe(41_000);
    expect(parseRiyals("١٧٬٥٧٢")).toBe(1_757_200);
  });

  it("يرفض ما ليس مبلغاً", () => {
    expect(parseRiyals("SAR410")).toBeNull();
    expect(parseRiyals("410.000")).toBeNull();
    expect(parseRiyals("")).toBeNull();
  });

  it("يطبع منزلتين دائماً", () => {
    expect(formatRiyals(41_000)).toBe("410.00");
    expect(formatRiyals(5)).toBe("0.05");
    expect(formatRiyals(1_757_200)).toBe("17572.00");
    expect(formatRiyalsDisplay(1_757_200)).toBe("17,572.00");
  });

  it("لا يفقد هللة في الجمع المتكرر", () => {
    // 0.1 + 0.2 !== 0.3 في الفاصلة العائمة. بالهللات لا خطأ إطلاقاً.
    let total = 0;
    for (let i = 0; i < 1000; i++) total += 1010; // ١٠٫١٠ ريال
    expect(total).toBe(1_010_000);
    expect(formatRiyals(total)).toBe("10100.00");
  });
});
