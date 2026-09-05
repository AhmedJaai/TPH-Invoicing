import { describe, expect, it } from "vitest";
import { fromCategory, toCategory } from "./apply";
import type { TxCategory } from "./rules";
import type { TxKind } from "./taxonomy";
import { CATEGORY_LABEL } from "./rules";
import { KIND_LABEL } from "./taxonomy";

const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as TxCategory[];
const ALL_KINDS = Object.keys(KIND_LABEL) as TxKind[];

describe("الترجمة بين لغة المحرّك وعمود القاعدة", () => {
  /**
   * هذا الاختبار كان سيمنع عطلاً حقيقياً: ذاكرة المستفيدين كانت
   * تُسنِد `TxCategory` إلى `TxKind` بـ`as`، فتخرج كل جهةٍ متعلَّمة من
   * مطابقة الفواتير صامتةً — والتعلّم يُنقص المطابقات بدل أن يزيدها.
   */
  it("كل باب في القاعدة له نوعٌ في المحرّك", () => {
    for (const c of ALL_CATEGORIES) {
      expect(fromCategory(c)).toBeDefined();
      expect(ALL_KINDS).toContain(fromCategory(c));
    }
  });

  it("وكل نوع في المحرّك له باب في القاعدة", () => {
    for (const k of ALL_KINDS) {
      expect(toCategory(k)).toBeDefined();
      expect(ALL_CATEGORIES).toContain(toCategory(k));
    }
  });

  it("سداد المورّد يعود سداد مورّد — لا يضيع في الترجمة", () => {
    expect(fromCategory("SUPPLIER")).toBe("SUPPLIER_PAYMENT");
    expect(toCategory("SUPPLIER_PAYMENT")).toBe("SUPPLIER");
  });

  it("حركات الشبكة تعبر الترجمة بلا تغيير", () => {
    for (const c of ["POS_SETTLEMENT", "POS_FEE", "POS_VAT", "BANK_FEE"] as const) {
      expect(toCategory(fromCategory(c))).toBe(c);
    }
  });

  it("المجهول لا يصير `undefined` أبداً — فيولّد جملةً مكسورة", () => {
    expect(toCategory("NOT_A_KIND" as TxKind)).toBe("UNKNOWN");
    expect(fromCategory("NOT_A_CATEGORY" as TxCategory)).toBe("UNKNOWN");
  });

  it("الرحلة ذهاباً وإياباً تحفظ المعنى لما له مقابل", () => {
    for (const c of ALL_CATEGORIES) {
      const back = toCategory(fromCategory(c));
      // «أخرى» و«شخصي» تنطويان في أنواع أعمّ، وما عداهما يعود كما هو
      if (c !== "OTHER" && c !== "PERSONAL") expect(back).toBe(c);
    }
  });
});
