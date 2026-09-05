import { describe, expect, it } from "vitest";
import { EXCLUSIVE_KINDS, SHARED_KINDS, isConflict, isExclusive } from "./evidence-uniqueness";

describe("فرادة الدليل بحسب نوعه", () => {
  it("الأرقام الرسمية قاطعة", () => {
    for (const k of EXCLUSIVE_KINDS) expect(isExclusive(k)).toBe(true);
  });

  it("الاسم والمرجع ظنّيان", () => {
    for (const k of SHARED_KINDS) expect(isExclusive(k)).toBe(false);
  });

  /*
    هذه هي العلّة نفسها: كان الاسم يُحتكَر فيمتنع وجود مؤسّستين
    بالاسم نفسه — وفي السعودية آلاف «مؤسسة الرياض للتجارة».
  */
  it("اسمٌ عند جهةٍ أخرى ليس تضارباً", () => {
    expect(isConflict("NAME", false)).toBe(false);
  });

  it("رقم حسابٍ عند جهةٍ أخرى تضاربٌ يُعرَض", () => {
    expect(isConflict("ACCOUNT", false)).toBe(true);
    expect(isConflict("IBAN", false)).toBe(true);
    expect(isConflict("NATIONAL_ID", false)).toBe(true);
    expect(isConflict("MERCHANT_ID", false)).toBe(true);
  });

  it("الدليل عند الجهة نفسها ليس تضارباً مهما كان نوعه", () => {
    expect(isConflict("ACCOUNT", true)).toBe(false);
    expect(isConflict("NAME", true)).toBe(false);
  });
});
