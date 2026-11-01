import { describe, expect, it } from "vitest";
import { can, capabilitiesOf, identityAllowed, parseAllowlist, require_, ForbiddenError } from "./permissions";

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

describe("من يصنّف حركات البنك ينشئ مورّداً", () => {
  /*
    «ليس في القائمة؟ مورّدٌ جديد» يظهر في شاشات البنك لمن يملك `bank:edit`
    (استيرادُ الكشف، والطابور، ومراجعةُ الحركات) — فإن فقد دورٌ `supplier:edit`
    صار الزرُّ ميّتاً يُردّ بـ403.
  */
  it("كلّ دور له bank:edit له supplier:edit", () => {
    for (const role of ["OWNER", "ACCOUNTANT", "PURCHASING"] as const) {
      if (can(role, "bank:edit")) expect(can(role, "supplier:edit")).toBe(true);
    }
  });
});

describe("identityAllowed — القائمة وشهادة جوجل معاً", () => {
  const list = parseAllowlist("owner@gmail.com:OWNER");
  it("بريدٌ في القائمة شهد جوجل أنّه لصاحبه يدخل، بأيّ حالة أحرف", () => {
    expect(identityAllowed({ email: "Owner@Gmail.com", provider: "google", emailVerified: true }, list)).toBe(true);
  });
  it("وبلا شهادة التحقّق لا يدخل — ولو كان في القائمة", () => {
    expect(identityAllowed({ email: "owner@gmail.com", provider: "google", emailVerified: false }, list)).toBe(false);
    expect(identityAllowed({ email: "owner@gmail.com", provider: "google", emailVerified: undefined }, list)).toBe(false);
    expect(identityAllowed({ email: "owner@gmail.com", provider: "google", emailVerified: "true" }, list)).toBe(false);
  });
  it("ومزوّدٌ غير جوجل لا يدخل، ولا بريدٌ خارج القائمة ولا فارغ", () => {
    expect(identityAllowed({ email: "owner@gmail.com", provider: "github", emailVerified: true }, list)).toBe(false);
    expect(identityAllowed({ email: "x@gmail.com", provider: "google", emailVerified: true }, list)).toBe(false);
    expect(identityAllowed({ email: null, provider: "google", emailVerified: true }, list)).toBe(false);
  });
  it("والقائمةُ الفارغة تغلق الباب كلَّه", () => {
    expect(identityAllowed({ email: "owner@gmail.com", provider: "google", emailVerified: true }, parseAllowlist(undefined))).toBe(false);
  });
});
