import { describe, expect, it } from "vitest";
import { suggestSuppliers, tokens } from "./supplier-suggest";

const S = [
  { id: "1", nameAr: "الكوب الذهبي", slug: "GoldenCup" },
  { id: "2", nameAr: "المحمصة الغربية", slug: "WesternRoastery" },
  { id: "3", nameAr: "شركة المشروبات النقية", slug: "PureDrinks" },
  { id: "4", nameAr: "مختبرات القهوة", slug: "CoffeeLabs" },
];

describe("اقتراحُ المورّد من نصّ البنك", () => {
  it("يجد المورّد من رمزه اللاتينيّ في نصّ الحوالة", () => {
    expect(suggestSuppliers("حوالات تحت الطلب 20260903S ANCB GOLDEN CUP TRADING", S).map((s) => s.id)).toEqual(["1"]);
  });

  it("يجد المورّد من اسمه العربيّ، بلا «ال» التعريف ولا صيغة الشركة", () => {
    expect(suggestSuppliers("تحويل الى محمصة غربية", S)[0].id).toBe("2");
    expect(suggestSuppliers("شركه المشروبات", S)[0].id).toBe("3");
  });

  it("لا يقترح شيئاً من كلماتٍ لا تميّز أحداً", () => {
    expect(suggestSuppliers("حوالات تحت الطلب SAR 1250 trading co", S)).toEqual([]);
  });

  it("الكلماتُ: الحروفُ الكبيرة تُقسَم، والأعدادُ والقصيرةُ تسقط", () => {
    expect(tokens("CoffeeLabs 2026 ab")).toEqual(["coffee", "labs"]);
  });
});
