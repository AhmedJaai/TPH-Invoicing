import { describe, expect, it } from "vitest";
import { bankLabel, detectBank } from "./detect";

const at = (text: string, fileName = "statement.xlsx") => detectBank({ text, fileName });

describe("detectBank", () => {
  it("يعرف الأهليّ من نصّه الحقيقيّ", () => {
    const d = at("البنك الأهلي السعودي — كشف حساب — الأهلي إي كورب")!;
    expect(d.bankId).toBe("SNB");
    expect(d.confidence).toBeGreaterThan(0.7);
  });

  it("ويعرفه من اسم الملفّ وحده", () => {
    const d = at("", "E-Statement_SNB_260505.xlsx")!;
    expect(d.bankId).toBe("SNB");
  });

  it("الثقة تنمو بعدد العلامات لا بأوّلها", () => {
    const one = at("الراجحي")!;
    const many = at("مصرف الراجحي — Al Rajhi Bank — RJHI")!;
    expect(many.confidence).toBeGreaterThan(one.confidence);
  });

  it("يميّز البنوك بعضها من بعض", () => {
    expect(at("مصرف الإنماء")!.bankId).toBe("ALINMA");
    expect(at("بنك الرياض")!.bankId).toBe("RIYAD");
    expect(at("العربي الوطني")!.bankId).toBe("ANB");
  });

  it("ما لا يُعرَف لا يُخمَّن ولا يُنسَب إلى الأكثر شيوعاً", () => {
    expect(at("كشف حساب لشهر أغسطس")).toBeNull();
    expect(bankLabel(null)).toBe("غير محدَّد");
  });

  it("الثقة لا تبلغ اليقين التامّ أبداً", () => {
    const d = at("SNB البنك الأهلي الأهلي السعودي Saudi National Bank الأهلي إي كورب")!;
    expect(d.confidence).toBeLessThan(1);
  });

  it("يذكر ما دلّ عليه كي يُعرَض عند الشكّ", () => {
    const d = at("البنك الأهلي")!;
    expect(d.matched.length).toBeGreaterThan(0);
  });

  it("النتيجة ثابتة", () => {
    const text = "مصرف الراجحي كشف حساب";
    expect(detectBank({ text, fileName: "a" })).toEqual(detectBank({ text, fileName: "a" }));
  });
});
