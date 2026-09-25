import { describe, expect, it } from "vitest";
import { auditKind, isAuditKind } from "./audit-kinds";
import { ACTION_LABEL } from "./audit-labels";

describe("أبواب سجلّ التدقيق", () => {
  it("المالُ قبل المورّدين: رصيدُ المورّد المخصوم سدادٌ لا تعديلُ مورّد", () => {
    expect(auditKind("SUPPLIER_CREDIT_APPLIED")).toBe("money");
    expect(auditKind("SUPPLIER_UPDATED")).toBe("suppliers");
  });

  it("التعلّمُ الآليّ بابٌ وحده — يُخفى افتراضاً", () => {
    expect(auditKind("SUPPLIER_ALIAS_LEARNED")).toBe("learned");
    expect(auditKind("BANK_RULE_LEARNED")).toBe("learned");
  });

  it("كلُّ فعلٍ مسمّى له بابٌ غير «أخرى» — إلّا تغيير الدور", () => {
    const orphans = Object.keys(ACTION_LABEL).filter((a) => auditKind(a) === "other");
    expect(orphans).toEqual(["USER_ROLE_CHANGED"]);
  });

  it("يرفض باباً غير معروف في العنوان", () => {
    expect(isAuditKind("money")).toBe(true);
    expect(isAuditKind("__proto__")).toBe(false);
    expect(isAuditKind(undefined)).toBe(false);
  });
});
