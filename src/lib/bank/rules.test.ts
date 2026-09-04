import { describe, expect, it } from "vitest";
import { findRule, ruleMatches, suggestCategory, type BankRule } from "./rules";
import { normalizeName } from "@/lib/suppliers-seed";

const rule = (pattern: string, category: BankRule["category"], id = pattern): BankRule => ({
  id, normalized: normalizeName(pattern), category,
});

describe("ruleMatches", () => {
  it("يطابق النمط داخل وصف مزدحم", () => {
    expect(ruleMatches(rule("سابع جار", "RENT"), "تحويل الى مؤسسة سابع جار للايجار 99231")).toBe(true);
  });

  it("يتجاوز القطع في وصف البنك بمطابقة الكلمات المميِّزة", () => {
    const r = rule("انس غالب حمزه خاشقجي", "SUPPLIER");
    expect(ruleMatches(r, "شركة انس غالب حمزه  خاشقجي التجارية المحد ودة")).toBe(true);
  });

  it("لا يطابق حين تغيب إحدى الكلمات المميِّزة", () => {
    expect(ruleMatches(rule("احمد الجعيدي", "PERSONAL"), "تحويل الى محمد الجعيدي")).toBe(false);
  });

  it("الوصف الفارغ لا يطابق شيئاً", () => {
    expect(ruleMatches(rule("زكاة", "ZAKAT"), "")).toBe(false);
  });
});

describe("findRule", () => {
  const rules = [
    rule("جار", "SUPPLIER", "r-short"),
    rule("سابع جار", "RENT", "r-long"),
  ];

  it("الأخصّ يسبق الأعمّ", () => {
    expect(findRule("تحويل الى سابع جار", rules)?.id).toBe("r-long");
  });

  it("بلا قاعدة منطبقة يرجع فراغاً", () => {
    expect(findRule("تحويل الى جهة اخرى", rules)).toBeUndefined();
  });
});

describe("suggestCategory", () => {
  it("يقترح الزكاة والراتب والإيجار والكهرباء", () => {
    expect(suggestCategory("سداد زكاة عن العام")).toBe("ZAKAT");
    expect(suggestCategory("مسير رواتب الموظفين")).toBe("SALARY");
    expect(suggestCategory("دفعة ايجار المحل")).toBe("RENT");
    expect(suggestCategory("الشركة السعودية للكهرباء")).toBe("UTILITY");
    expect(suggestCategory("التامينات الاجتماعية")).toBe("GOVERNMENT");
  });

  it("ما لا كلمة دالّة فيه يبقى غير مصنَّف — لا يُخمَّن", () => {
    expect(suggestCategory("تحويل الى مؤسسة النور التجارية")).toBe("UNKNOWN");
  });

  it("الوصف الفارغ غير مصنَّف", () => {
    expect(suggestCategory("")).toBe("UNKNOWN");
  });
});

describe("اقتراحات من كشف الأهلي الفعلي", () => {
  it("هيئة الزكاة والضريبة جهة حكومية لا زكاة تُخرَج", () => {
    expect(suggestCategory("Zakat, Tax and Customs Au thority رقم السداد31000797162630")).toBe("GOVERNMENT");
  });

  it("الرواتب بالعربية والإنجليزية", () => {
    expect(suggestCategory("البراء محمد يسلم الجعيدي BEN ID:2216139259 BV:رواتب شهرية")).toBe("SALARY");
    expect(suggestCategory("الوليد محمد علي بامخشب BEN ID:1129311518 BV:Monthly Salary")).toBe("SALARY");
  });

  it("الكهرباء والاتصالات مرافق", () => {
    expect(suggestCategory("Saudi Energy رقم السداد30151604771")).toBe("UTILITY");
    expect(suggestCategory("SAUDI TELECOM CO. رقم السداد05280028829")).toBe("UTILITY");
  });

  it("الأمانة جهة حكومية", () => {
    expect(suggestCategory("Ministry of Municipal and  Rural Affairs")).toBe("GOVERNMENT");
  });

  it("الزكاة الحقيقية تبقى زكاة", () => {
    expect(suggestCategory("تحويل صدقة")).toBe("ZAKAT");
  });

  it("اسم مورّد عادي لا يُخمَّن له تصنيف", () => {
    expect(suggestCategory("شركة انس غالب حمزه خاشقجي التجارية")).toBe("UNKNOWN");
  });
});
