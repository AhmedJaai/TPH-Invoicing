import { describe, expect, it } from "vitest";
import { FINDING_KINDS } from "./ai/finding-labels";
import { CATEGORY_LABEL } from "./bank/rules";
import { VALUE_LABEL, labelValue } from "./audit-labels";

describe("تسميات سجلّ التدقيق", () => {
  it("لكلّ نوع اقتراحٍ تسمية", () => {
    for (const kind of FINDING_KINDS) {
      expect(VALUE_LABEL[kind], kind).toBeTruthy();
      expect(VALUE_LABEL[kind]).not.toBe(kind);
    }
  });

  it("لكلّ باب حركةٍ تسمية", () => {
    for (const category of Object.keys(CATEGORY_LABEL)) {
      expect(VALUE_LABEL[category], category).toBeTruthy();
      expect(VALUE_LABEL[category]).not.toBe(category);
    }
  });

  it("ولا تسمية إنجليزيّة واحدة", () => {
    for (const [key, label] of Object.entries(VALUE_LABEL)) {
      expect(/[A-Za-z]/.test(label) && label === key, key).toBe(false);
    }
  });

  it("وما لا تسمية له يبقى كما هو — السجلّ لا يُخفي شيئاً وقع", () => {
    expect(labelValue("MISSING_INVOICES")).toBe("دفعتَ أكثر من فواتيره");
    expect(labelValue("BANK_FEE")).toBe("رسوم بنكية");
    expect(labelValue("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(labelValue(42)).toBe("42");
  });
});
