import { describe, expect, it } from "vitest";
import { can, capabilitiesOf, parseAllowlist, require_, ForbiddenError } from "./permissions";

describe("مصفوفة الصلاحيات", () => {
  it("المالك يملك كل شيء", () => {
    for (const c of capabilitiesOf("OWNER")) expect(can("OWNER", c)).toBe(true);
    expect(can("OWNER", "users:manage")).toBe(true);
    expect(can("OWNER", "payroll:view")).toBe(true);
  });

  it("المحاسب يرى المالية ولا يدير المستخدمين", () => {
    expect(can("ACCOUNTANT", "amounts:view")).toBe(true);
    expect(can("ACCOUNTANT", "bank:view")).toBe(true);
    expect(can("ACCOUNTANT", "reports:view")).toBe(true);
    expect(can("ACCOUNTANT", "users:manage")).toBe(false);
    expect(can("ACCOUNTANT", "payroll:view")).toBe(false);
  });

  it("مدير المشتريات لا يرى رقماً مالياً ولا بنكاً ولا راتباً", () => {
    expect(can("PURCHASING", "document:upload")).toBe(true);
    expect(can("PURCHASING", "supplier:view")).toBe(true);
    expect(can("PURCHASING", "amounts:view")).toBe(false);
    expect(can("PURCHASING", "bank:view")).toBe(false);
    expect(can("PURCHASING", "payroll:view")).toBe(false);
    expect(can("PURCHASING", "reports:view")).toBe(false);
    expect(can("PURCHASING", "payment:approve")).toBe(false);
  });

  it("اعتماد الدفعات وإدارة المستخدمين للمالك وحده", () => {
    for (const role of ["ACCOUNTANT", "PURCHASING"] as const) {
      expect(can(role, "payment:approve")).toBe(false);
      expect(can(role, "users:manage")).toBe(false);
    }
  });

  it("بلا دور لا صلاحية", () => {
    expect(can(null, "document:view")).toBe(false);
    expect(can(undefined, "document:upload")).toBe(false);
  });

  it("require_ يرمي خطأ مفهوماً", () => {
    expect(() => require_("PURCHASING", "amounts:view")).toThrow(ForbiddenError);
    expect(() => require_("OWNER", "amounts:view")).not.toThrow();
  });
});

describe("قائمة الدخول البيضاء", () => {
  it("تقرأ الإيميلات وأدوارها", () => {
    const m = parseAllowlist("A@X.com:OWNER, b@x.com:ACCOUNTANT ,c@x.com:PURCHASING");
    expect(m.get("a@x.com")).toBe("OWNER");
    expect(m.get("b@x.com")).toBe("ACCOUNTANT");
    expect(m.get("c@x.com")).toBe("PURCHASING");
  });

  it("الدور الافتراضي هو الأقل صلاحية", () => {
    expect(parseAllowlist("x@y.com").get("x@y.com")).toBe("PURCHASING");
    expect(parseAllowlist("x@y.com:ADMIN").get("x@y.com")).toBe("PURCHASING");
  });

  it("القائمة الفارغة لا تسمح لأحد", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("").size).toBe(0);
  });
});
