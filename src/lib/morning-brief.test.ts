import { describe, expect, it } from "vitest";
import { buildBrief, type BriefFacts } from "./morning-brief";

const facts: BriefFacts = {
  dateLabel: "الجمعة 9 أكتوبر 2026", knowsNothing: false,
  owedMinor: 1_240_000, owedSuppliers: 5, weekMinor: 320_000, balanceMinor: 4_500_050, pending: 4,
};

describe("إحاطةُ الصباح نصّاً", () => {
  it("تقول الأرقامَ بمبالغها", () => {
    const t = buildBrief(facts);
    expect(t).toContain("عليك للمورّدين 12,400.00 ريال");
    expect(t).toContain("يخرج هذا الأسبوع 3,200.00 ريال");
    expect(t).toContain("45,000.50");
    expect(t.split("\n")).toHaveLength(5);
  });

  it("الرصيدُ المجهول يُقال «غير معروف» لا صفراً", () => {
    const t = buildBrief({ ...facts, balanceMinor: null });
    expect(t).toContain("رصيدُ البنك غير معروف");
    expect(t).not.toContain("رصيدٍ معروف 0");
  });

  it("ومن لا يرى البنك لا يُذكَر له رصيد", () => {
    expect(buildBrief({ ...facts, balanceMinor: undefined })).not.toContain("رصيد");
  });

  it("ما لا يراه صاحبُ الدور لا يُذكَر", () => {
    expect(buildBrief({ ...facts, weekMinor: null })).not.toContain("هذا الأسبوع");
  });

  it("الصفرُ المعلوم جملةٌ لا «0.00»", () => {
    const t = buildBrief({ ...facts, owedMinor: 0, owedSuppliers: 0, pending: 0, weekMinor: 0 });
    expect(t).toContain("لا مستحقّ للمورّدين الآن");
    expect(t).toContain("لا شيء ينتظر القرار");
    expect(t).not.toContain("0.00");
  });

  it("قاعدةٌ لا تعرف شيئاً لا تقول أرقاماً", () => {
    const t = buildBrief({ ...facts, knowsNothing: true });
    expect(t).not.toMatch(/\d{1,3},\d{3}/);
    expect(t).toContain("لم يقرأ");
  });
});
